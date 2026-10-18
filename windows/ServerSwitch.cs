using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace TeamTourLauncher
{
    public enum ServerState
    {
        Public,
        TeamTour
    }

    /// <summary>
    /// The server-switch logic, with no UI and no process launching: it only reads and writes files
    /// under one Balatro folder. Mirrors the Mac and Linux scripts exactly.
    /// </summary>
    public sealed class ServerSwitch
    {
        public const string OurHost = "mp.balatroleague.com";
        public const string PublicHost = "balatro.virtualized.dev";
        public const string EnvContents = "server_url=" + OurHost + "\nserver_port=8788\n";

        // Latin-1 maps every byte to one char, so reading and writing never alters bytes.
        private static readonly Encoding Latin1 = Encoding.GetEncoding(28591);

        private readonly string balatroDir;

        public ServerSwitch(string balatroDir)
        {
            this.balatroDir = balatroDir;
        }

        private string ModsDir
        {
            get { return Path.Combine(balatroDir, "Mods"); }
        }

        private string JkrPath
        {
            get { return Path.Combine(balatroDir, "config", "Multiplayer.jkr"); }
        }

        private IEnumerable<string> ModFolders()
        {
            if (!Directory.Exists(ModsDir)) return new string[0];
            var dirs = Directory.GetDirectories(ModsDir);
            Array.Sort(dirs, StringComparer.Ordinal);
            return dirs;
        }

        /// <summary>Mods/*/ folders whose core.lua contains "MP.ENV".</summary>
        public IList<string> FindMultiplayerFolders()
        {
            return ModFolders().Where(IsMultiplayerFolder).ToList();
        }

        /// <summary>
        /// The Multiplayer mod: Multiplayer.json has the top-level id "Multiplayer" (what the official
        /// Multiplayer launcher checks) AND core.lua mentions MP.ENV, i.e. this version reads a .env.
        /// Unreadable or malformed files mean "not Multiplayer", never an exception.
        /// </summary>
        private static bool IsMultiplayerFolder(string dir)
        {
            try
            {
                var core = Path.Combine(dir, "core.lua");
                return HasMultiplayerId(Path.Combine(dir, "Multiplayer.json"))
                    && File.Exists(core)
                    && Latin1.GetString(File.ReadAllBytes(core)).Contains("MP.ENV");
            }
            catch (IOException)
            {
                return false;
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        private static bool HasMultiplayerId(string jsonPath)
        {
            if (!File.Exists(jsonPath)) return false;
            try
            {
                var parsed = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(jsonPath));
                var top = parsed as IDictionary<string, object>;
                object id;
                return top != null && top.TryGetValue("id", out id) && (id as string) == "Multiplayer";
            }
            catch (ArgumentException) { return false; }          // malformed JSON
            catch (InvalidOperationException) { return false; }  // malformed JSON
        }

        public bool IsInstalled
        {
            get { return FindMultiplayerFolders().Count > 0; }
        }

        /// <summary>Team Tour when any Multiplayer folder has a .env, else Public.</summary>
        public ServerState GetState()
        {
            return FindMultiplayerFolders().Any(d => File.Exists(Path.Combine(d, ".env")))
                ? ServerState.TeamTour
                : ServerState.Public;
        }

        public void SwitchToTeamTour()
        {
            foreach (var dir in FindMultiplayerFolders())
            {
                File.WriteAllBytes(Path.Combine(dir, ".env"), Encoding.ASCII.GetBytes(EnvContents));
            }
        }

        /// <summary>Deletes .env in every Multiplayer folder (never other mods) and repairs Multiplayer.jkr at the byte level.</summary>
        public void SwitchToPublic()
        {
            foreach (var dir in FindMultiplayerFolders())
            {
                var env = Path.Combine(dir, ".env");
                if (File.Exists(env)) File.Delete(env);
            }
            if (File.Exists(JkrPath))
            {
                var data = File.ReadAllBytes(JkrPath);
                var fixedData = ReplaceBytes(data, Encoding.ASCII.GetBytes(OurHost), Encoding.ASCII.GetBytes(PublicHost));
                if (!fixedData.SequenceEqual(data)) WriteAtomically(JkrPath, fixedData);
            }
        }

        /// <summary>Writes beside the target and swaps it in, so a failure never leaves a half-written file.</summary>
        private static void WriteAtomically(string path, byte[] data)
        {
            var tmp = path + ".tmp";
            try
            {
                File.WriteAllBytes(tmp, data);
                File.Replace(tmp, path, null);
            }
            catch
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                throw;
            }
        }

        public void SwitchToOther()
        {
            if (GetState() == ServerState.TeamTour) SwitchToPublic();
            else SwitchToTeamTour();
        }

        /// <summary>Replaces every occurrence of find with replacement, leaving all other bytes alone.</summary>
        public static byte[] ReplaceBytes(byte[] data, byte[] find, byte[] replacement)
        {
            var output = new List<byte>(data.Length);
            var i = 0;
            while (i < data.Length)
            {
                if (Matches(data, i, find))
                {
                    output.AddRange(replacement);
                    i += find.Length;
                }
                else
                {
                    output.Add(data[i]);
                    i++;
                }
            }
            return output.ToArray();
        }

        private static bool Matches(byte[] data, int at, byte[] find)
        {
            if (at + find.Length > data.Length) return false;
            for (var k = 0; k < find.Length; k++)
            {
                if (data[at + k] != find[k]) return false;
            }
            return true;
        }
    }
}
