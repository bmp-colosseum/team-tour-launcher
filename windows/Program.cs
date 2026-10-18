using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace TeamTourLauncher
{
    internal static class Program
    {
        // Test arguments: --choice switch,play runs window-less and prints to stdout;
        // --no-launch prints/skips the Steam launch; --appdata <dir> replaces the AppData folder;
        // --font-scale 1.5 renders the GUI text larger; --layout-check prints whether the window
        // fits at 1x, 1.25x, 1.5x and 2x text and exits 0 only when it does.
        [STAThread]
        private static int Main(string[] args)
        {
            var headless = Array.IndexOf(args, "--choice") >= 0 || Array.IndexOf(args, "--layout-check") >= 0;
            try
            {
                return Run(args);
            }
            catch (Exception ex)
            {
                var message = "Team Tour Launcher hit an error: " + ex.Message;
                if (headless) Console.Error.WriteLine(message);
                else MessageBox.Show(message, "Team Tour Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static int Run(string[] args)
        {
            string choice = null;
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var noLaunch = false;
            var layoutCheck = false;
            var fontScale = 1f;
            for (var i = 0; i < args.Length; i++)
            {
                if (args[i] == "--choice" && i + 1 < args.Length) choice = args[++i];
                else if (args[i] == "--appdata" && i + 1 < args.Length) appData = args[++i];
                else if (args[i] == "--no-launch") noLaunch = true;
                else if (args[i] == "--layout-check") layoutCheck = true;
                else if (args[i] == "--font-scale" && i + 1 < args.Length)
                    fontScale = float.Parse(args[++i], System.Globalization.CultureInfo.InvariantCulture);
            }
            var server = new ServerSwitch(Path.Combine(appData, "Balatro"));

            if (choice != null)
            {
                var actions = choice.Length == 0 ? new string[0] : choice.Split(',');
                var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
                return Headless.Run(server, actions, noLaunch, stdout, url =>
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }));
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (layoutCheck)
            {
                var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
                var failed = false;
                foreach (var scale in new[] { 1f, 1.25f, 1.5f, 2f })
                {
                    using (var form = new MainForm(server, true, scale))
                    {
                        var problems = form.CheckLayout();
                        if (problems.Count == 0) stdout.WriteLine("layout ok at " + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + "x");
                        foreach (var p in problems)
                        {
                            failed = true;
                            stdout.WriteLine("layout problem at " + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + "x: " + p);
                        }
                    }
                }
                return failed ? 1 : 0;
            }

            if (!server.IsInstalled)
            {
                MessageBox.Show(Headless.NotFoundMessage, "Team Tour Launcher", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 0;
            }
            Application.Run(new MainForm(server, noLaunch, fontScale));
            return 0;
        }
    }
}
