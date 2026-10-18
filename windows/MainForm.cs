using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace TeamTourLauncher
{
    /// <summary>The one window: a coloured circle, the status line and three buttons.</summary>
    public sealed class MainForm : Form
    {
        private readonly ServerSwitch server;
        private readonly bool noLaunch;
        private readonly Panel mark = new Panel();
        private readonly Label status = new Label();
        private readonly Button switchButton = new Button();
        private readonly Button playButton = new Button();
        private readonly Button quitButton = new Button();
        private ServerState state;

        /// <param name="fontScale">Test hook: 1.5 renders the text as at 150% so clipping shows up.</param>
        public MainForm(ServerSwitch server, bool noLaunch, float fontScale = 1f)
        {
            this.server = server;
            this.noLaunch = noLaunch;

            // 96 dpi design units; Windows scales the layout, the flow panels size to the text.
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 10f * fontScale);
            Text = "Team Tour Launcher";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }

            mark.Size = new Size(28, 28);
            mark.Margin = new Padding(0, 0, 12, 0);
            mark.Paint += PaintMark;
            status.AutoSize = true;
            status.Margin = new Padding(0, 4, 0, 0);

            var top = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Margin = new Padding(0, 0, 0, 18)
            };
            top.Controls.Add(mark);
            top.Controls.Add(status);

            Prepare(switchButton, 0, new Padding(0, 0, 10, 0));
            Prepare(playButton, 110, new Padding(0, 0, 10, 0));
            Prepare(quitButton, 80, Padding.Empty);
            playButton.Text = "Play Balatro";
            quitButton.Text = "Quit";
            switchButton.Click += delegate { OnSwitch(); };
            playButton.Click += delegate { OnPlay(); };
            quitButton.Click += delegate { Close(); };

            var buttons = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Margin = Padding.Empty
            };
            buttons.Controls.AddRange(new Control[] { switchButton, playButton, quitButton });

            var root = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(20, 20, 20, 20)
            };
            root.Controls.Add(top);
            root.Controls.Add(buttons);
            Controls.Add(root);

            AcceptButton = playButton;
            CancelButton = quitButton;
            ActiveControl = playButton; // Enter plays

            // The switch button's text changes with the state: reserve room for the longer one so the window never jumps.
            var widest = 0;
            foreach (var s in new[] { ServerState.Public, ServerState.TeamTour })
            {
                ApplyState(s);
                widest = Math.Max(widest, switchButton.PreferredSize.Width);
            }
            switchButton.MinimumSize = new Size(widest, switchButton.MinimumSize.Height);
            Refresh_();
        }

        private static void Prepare(Button b, int minWidth, Padding margin)
        {
            b.AutoSize = true;
            b.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            b.Padding = new Padding(12, 4, 12, 4);
            b.MinimumSize = new Size(minWidth, 36);
            b.Margin = margin;
        }

        private void ApplyState(ServerState s)
        {
            state = s;
            var team = s == ServerState.TeamTour;
            status.Text = team ? "You are on the Team Tour server." : "You are on the public server.";
            switchButton.Text = team ? "Switch to Public server" : "Switch to Team Tour server";
            mark.Invalidate();
        }

        private void Refresh_()
        {
            ApplyState(server.GetState());
        }

        /// <summary>
        /// Layout problems for both states at the current font: any button whose text does not fit, or
        /// whose preferred size exceeds its size. Empty when everything fits. Used by --layout-check.
        /// </summary>
        public IList<string> CheckLayout()
        {
            var problems = new List<string>();
            var _ = Handle; // create the handle so layout and measuring use real metrics
            foreach (var s in new[] { ServerState.Public, ServerState.TeamTour })
            {
                ApplyState(s);
                PerformLayout();
                foreach (var b in new[] { switchButton, playButton, quitButton })
                {
                    var need = TextRenderer.MeasureText(b.Text, b.Font).Width + b.Padding.Horizontal;
                    if (need > b.Width) problems.Add(s + ": button '" + b.Text + "' needs " + need + "px but is " + b.Width + "px");
                    if (b.PreferredSize.Width > b.Width || b.PreferredSize.Height > b.Height)
                        problems.Add(s + ": button '" + b.Text + "' preferred " + b.PreferredSize + " exceeds " + b.Size);
                }
                var textWidth = TextRenderer.MeasureText(status.Text, status.Font).Width;
                if (textWidth > status.Width) problems.Add(s + ": status text needs " + textWidth + "px but label is " + status.Width + "px");
                if (status.Right > ClientSize.Width) problems.Add(s + ": status label runs past the window edge");
            }
            Refresh_();
            return problems;
        }

        private void PaintMark(object sender, PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var color = state == ServerState.TeamTour ? Color.FromArgb(46, 160, 67) : Color.FromArgb(218, 54, 51);
            using (var brush = new SolidBrush(color))
            {
                e.Graphics.FillEllipse(brush, 1, 1, mark.Width - 3, mark.Height - 3);
            }
        }

        private void OnSwitch()
        {
            try
            {
                server.SwitchToOther();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Could not switch the server: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            Refresh_();
        }

        private void OnPlay()
        {
            if (!noLaunch)
            {
                try
                {
                    Process.Start(new ProcessStartInfo(Headless.SteamUrl) { UseShellExecute = true });
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, "Could not start Balatro: " + ex.Message + "\nStart it the way you usually do.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
            }
            Close();
        }
    }
}
