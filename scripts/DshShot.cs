// dsh-screenshot native engine: hide the foreground window, freeze the screen,
// let the user drag a rectangle, restore the window, save the crop as PNG.
// Compiled on demand by scripts/snip.ps1 (Add-Type), so it must stay
// C# 5-compatible (no string interpolation, no expression-bodied members).

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class DshShot
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const int SW_HIDE = 0;
    private const int SW_RESTORE = 9;
    private const uint GA_ROOT = 2;
    private static readonly string[] ExcludedProcesses = { "powershell", "pwsh", "cmd", "conhost", "WindowsTerminal", "wezterm-gui" };

    /// <summary>Outcome of one capture attempt; serialized by RunJson.</summary>
    public sealed class Outcome
    {
        public bool ok;
        public string path = "";
        public string reason = "";
        public string message = "";
        public int width;
        public int height;
    }

    /// <summary>Run one capture and answer a single-line JSON document.</summary>
    public static string RunJson(string outPath, int timeoutSeconds, string targetFile, string autoSelect, string titleFragment, bool hideWindow)
    {
        Outcome outcome = Run(outPath, timeoutSeconds, targetFile, autoSelect, titleFragment, hideWindow);
        return "{"
            + "\"ok\":" + (outcome.ok ? "true" : "false")
            + ",\"path\":" + Quote(outcome.path)
            + ",\"reason\":" + Quote(outcome.reason)
            + ",\"message\":" + Quote(outcome.message)
            + ",\"width\":" + outcome.width
            + ",\"height\":" + outcome.height
            + "}";
    }

    private static Outcome Run(string outPath, int timeoutSeconds, string targetFile, string autoSelect, string titleFragment, bool hideWindow)
    {
        Outcome outcome = new Outcome();
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch { try { SetProcessDPIAware(); } catch { } }

        // The window to hide is the page's own browser window. The caller passes
        // its document title because the foreground window at spawn time can be a
        // console that the launcher briefly owned. Without hiding there is no
        // window to find at all: the frozen frame simply keeps what is on screen.
        IntPtr target = IntPtr.Zero;
        if (hideWindow)
        {
            target = FindByTitle(titleFragment);
            if (target == IntPtr.Zero) target = GetAncestor(GetForegroundWindow(), GA_ROOT);
            if (target == IntPtr.Zero || !IsWindow(target))
            {
                outcome.reason = "failed";
                outcome.message = "no window to hide";
                return outcome;
            }
            if (targetFile != null && targetFile.Length > 0)
            {
                try { File.WriteAllText(targetFile, target.ToInt64().ToString()); } catch { }
            }
        }

        try
        {
            if (hideWindow)
            {
                ShowWindow(target, SW_HIDE);
                // The compositor needs a beat before the window is really gone.
                System.Threading.Thread.Sleep(180);
                if (IsWindowVisible(target))
                {
                    outcome.reason = "failed";
                    outcome.message = "could not hide the source window";
                    return outcome;
                }
            }
            else
            {
                // The veil covers the whole screen anyway; this only lets the
                // click's own repaint settle so the frozen frame has no hover state.
                System.Threading.Thread.Sleep(140);
            }

            Rectangle virtualScreen = SystemInformation.VirtualScreen;
            using (Bitmap frozen = new Bitmap(virtualScreen.Width, virtualScreen.Height, PixelFormat.Format32bppPArgb))
            {
                using (Graphics g = Graphics.FromImage(frozen))
                {
                    g.CopyFromScreen(virtualScreen.X, virtualScreen.Y, 0, 0, frozen.Size, CopyPixelOperation.SourceCopy);
                }

                Rectangle selection;
                if (autoSelect != null && autoSelect.Length > 0)
                {
                    selection = ParseRectangle(autoSelect);
                    if (selection.Width < 1 || selection.Height < 1)
                    {
                        outcome.reason = "failed";
                        outcome.message = "autoSelect is not x,y,w,h";
                        return outcome;
                    }
                }
                else
                {
                    Application.EnableVisualStyles();
                    using (Selector selector = new Selector(frozen, virtualScreen, timeoutSeconds))
                    {
                        Application.Run(selector);
                        if (selector.Cancelled)
                        {
                            outcome.reason = "cancelled";
                            return outcome;
                        }
                        selection = selector.Selection;
                    }
                }

                Rectangle safe = Rectangle.Intersect(selection, new Rectangle(0, 0, frozen.Width, frozen.Height));
                if (safe.Width < 1 || safe.Height < 1)
                {
                    outcome.reason = "cancelled";
                    return outcome;
                }

                using (Bitmap crop = new Bitmap(safe.Width, safe.Height, PixelFormat.Format32bppPArgb))
                {
                    using (Graphics g = Graphics.FromImage(crop))
                    {
                        g.DrawImage(frozen, new Rectangle(0, 0, safe.Width, safe.Height), safe, GraphicsUnit.Pixel);
                    }
                    string directory = Path.GetDirectoryName(outPath);
                    if (directory != null && directory.Length > 0) Directory.CreateDirectory(directory);
                    crop.Save(outPath, ImageFormat.Png);
                }

                outcome.ok = true;
                outcome.path = outPath;
                outcome.width = safe.Width;
                outcome.height = safe.Height;
                return outcome;
            }
        }
        catch (Exception error)
        {
            outcome.ok = false;
            outcome.reason = "failed";
            outcome.message = error.GetType().Name + ": " + error.Message;
            return outcome;
        }
        finally
        {
            // Whatever happened above, a window we hid must come back. Without
            // hiding there is nothing to restore, and the target stays zero.
            if (hideWindow && target != IntPtr.Zero)
            {
                ShowWindow(target, SW_RESTORE);
                SetForegroundWindow(target);
            }
        }
    }

    /// <summary>
    /// Locate the visible top-level browser window whose caption contains the
    /// page title. Consoles owned by this launch are skipped, so a briefly
    /// focused helper process cannot become the hidden window.
    /// </summary>
    private static IntPtr FindByTitle(string fragment)
    {
        if (fragment == null || fragment.Trim().Length < 4) return IntPtr.Zero;
        string needle = fragment.Trim();
        IntPtr found = IntPtr.Zero;

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            if (GetWindowTextLength(hWnd) == 0) return true;

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            string processName = "";
            try { processName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
            catch { }
            foreach (string excluded in ExcludedProcesses)
            {
                if (string.Equals(processName, excluded, StringComparison.OrdinalIgnoreCase)) return true;
            }

            System.Text.StringBuilder caption = new System.Text.StringBuilder(GetWindowTextLength(hWnd) + 2);
            GetWindowText(hWnd, caption, caption.Capacity);
            if (caption.ToString().IndexOf(needle, StringComparison.Ordinal) < 0) return true;

            found = hWnd;
            return false;
        }, IntPtr.Zero);

        return found;
    }

    private static Rectangle ParseRectangle(string spec)
    {
        string[] parts = spec.Split(',');
        if (parts.Length != 4) return Rectangle.Empty;
        int x, y, w, hgt;
        if (!int.TryParse(parts[0].Trim(), out x)) return Rectangle.Empty;
        if (!int.TryParse(parts[1].Trim(), out y)) return Rectangle.Empty;
        if (!int.TryParse(parts[2].Trim(), out w)) return Rectangle.Empty;
        if (!int.TryParse(parts[3].Trim(), out hgt)) return Rectangle.Empty;
        return new Rectangle(x, y, w, hgt);
    }

    private static string Quote(string value)
    {
        if (value == null) return "null";
        System.Text.StringBuilder sb = new System.Text.StringBuilder("\"");
        foreach (char c in value)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    /// <summary>Full-screen selection overlay painted over the frozen frame.</summary>
    public sealed class Selector : Form
    {
        private readonly Bitmap frozen;
        private readonly Timer clock;
        private readonly DateTime started = DateTime.UtcNow;
        private readonly int timeoutSeconds;
        private Point press;
        private bool dragging;

        public bool Cancelled = true;
        public Rectangle Selection = Rectangle.Empty;

        private static readonly Font LabelFont = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
        private static readonly Brush Veil = new SolidBrush(Color.FromArgb(110, 0, 0, 0));

        public Selector(Bitmap frozen, Rectangle screen, int timeoutSeconds)
        {
            this.frozen = frozen;
            this.timeoutSeconds = timeoutSeconds;

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = screen;
            TopMost = true;
            ShowInTaskbar = false;
            Cursor = Cursors.Cross;
            DoubleBuffered = true;
            BackColor = Color.Black;
            KeyPreview = true;

            clock = new Timer();
            clock.Interval = 250;
            clock.Tick += OnTick;
            clock.Start();
        }

        private void OnTick(object sender, EventArgs e)
        {
            if ((DateTime.UtcNow - started).TotalSeconds > timeoutSeconds)
            {
                Cancelled = true;
                Close();
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Activate();
            Focus();
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape)
            {
                Cancelled = true;
                Close();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.DrawImageUnscaled(frozen, 0, 0);
            g.FillRectangle(Veil, new Rectangle(0, 0, ClientSize.Width, ClientSize.Height));

            bool live = dragging && Selection.Width > 0 && Selection.Height > 0;
            if (!live)
            {
                string hint = "\u62d6\u52a8\u9009\u62e9\u533a\u57df    \u00b7    Esc \u53d6\u6d88    \u00b7    \u53f3\u952e\u53d6\u6d88";
                SizeF size = g.MeasureString(hint, LabelFont);
                float x = (ClientSize.Width - size.Width) / 2f;
                float y = 56f;
                using (SolidBrush back = new SolidBrush(Color.FromArgb(190, 0, 0, 0)))
                {
                    g.FillRectangle(back, x - 16f, y - 9f, size.Width + 32f, size.Height + 18f);
                }
                g.DrawString(hint, LabelFont, Brushes.White, x, y);
                return;
            }

            System.Drawing.Drawing2D.GraphicsState state = g.Save();
            g.SetClip(Selection);
            g.DrawImageUnscaled(frozen, 0, 0);
            g.Restore(state);

            using (Pen border = new Pen(Color.FromArgb(255, 255, 255), 1f))
            {
                g.DrawRectangle(border, Selection.X, Selection.Y, Selection.Width - 1, Selection.Height - 1);
            }

            string badge = Selection.Width.ToString() + " \u00d7 " + Selection.Height.ToString();
            SizeF badgeSize = g.MeasureString(badge, LabelFont);
            float badgeX = Selection.X;
            float badgeY = Selection.Y > 30f ? Selection.Y - 28f : Selection.Bottom + 8f;
            using (SolidBrush back = new SolidBrush(Color.FromArgb(210, 0, 0, 0)))
            {
                g.FillRectangle(back, badgeX, badgeY, badgeSize.Width + 14f, badgeSize.Height + 6f);
            }
            g.DrawString(badge, LabelFont, Brushes.White, badgeX + 7f, badgeY + 3f);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right)
            {
                Cancelled = true;
                Close();
                return;
            }
            if (e.Button != MouseButtons.Left) return;
            press = e.Location;
            dragging = true;
            Selection = new Rectangle(e.Location, Size.Empty);
            Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (!dragging) return;
            int x1 = Math.Min(press.X, e.X);
            int y1 = Math.Min(press.Y, e.Y);
            int x2 = Math.Max(press.X, e.X);
            int y2 = Math.Max(press.Y, e.Y);
            Selection = new Rectangle(x1, y1, x2 - x1, y2 - y1);
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (!dragging) return;
            dragging = false;
            if (Selection.Width >= 5 && Selection.Height >= 5)
            {
                Cancelled = false;
                Close();
                return;
            }
            // A stray click keeps the mode open instead of cancelling it.
            Selection = Rectangle.Empty;
            Invalidate();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            clock.Stop();
            clock.Dispose();
            base.OnFormClosed(e);
        }
    }
}
