using System;
using System.Collections.Generic;
using System.IO;

namespace TeamTourLauncher
{
    /// <summary>
    /// Window-less mode for tests: runs a scripted list of actions (switch, play, quit) and prints
    /// the same lines the Mac and Linux launchers print, so one harness drives every OS.
    /// </summary>
    public static class Headless
    {
        public const string SteamUrl = "steam://rungameid/2379780";
        public const string NotFoundMessage = "Could not find a current Multiplayer mod. Install or update it with the Multiplayer launcher.";

        public static string StatusLine(ServerState state)
        {
            return state == ServerState.TeamTour
                ? "[green] You are on the Team Tour server."
                : "[red] You are on the public server.";
        }

        /// <param name="startUrl">Called for Play when noLaunch is false.</param>
        public static int Run(ServerSwitch server, IList<string> actions, bool noLaunch, TextWriter output, Action<string> startUrl)
        {
            if (!server.IsInstalled)
            {
                output.WriteLine(NotFoundMessage);
                return 0;
            }
            var next = 0;
            while (true)
            {
                output.WriteLine(StatusLine(server.GetState()));
                var action = next < actions.Count ? actions[next] : "quit";
                next++;
                if (string.Equals(action, "switch", StringComparison.OrdinalIgnoreCase))
                {
                    server.SwitchToOther();
                }
                else if (string.Equals(action, "play", StringComparison.OrdinalIgnoreCase))
                {
                    if (noLaunch) output.WriteLine("LAUNCH: start \"\" \"" + SteamUrl + "\"");
                    else startUrl(SteamUrl);
                    return 0;
                }
                else
                {
                    output.WriteLine("No change.");
                    return 0;
                }
            }
        }
    }
}
