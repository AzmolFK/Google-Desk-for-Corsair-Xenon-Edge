// Native Windows launcher. No console window, telemetry or automatic installation.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    static readonly string Data = Environment.GetEnvironmentVariable("GOOGLE_DESK_DATA_DIR") ?? Path.Combine(Root, "data");
    static readonly string ControlFile = Path.Combine(Data, "desktop.bin");
    static readonly string RunName = "GoogleDesk-" + Identity(Root);
    static NotifyIcon icon;
    static Process child;
    static System.Windows.Forms.Timer timer;
    static bool stopping;
    static bool ready;
    static bool openWhenReady;
    static int ticks;
    static Mutex instance;

    static string Identity(string value)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value.ToLowerInvariant()))).Replace("-", "").Substring(0, 16);
    }

    // Windows CommandLineToArgvW-compatible quoting, including trailing backslashes.
    static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(c); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }

    static string FindPython()
    {
        var local = Path.Combine(Root, ".venv", "Scripts", "pythonw.exe");
        if (File.Exists(local)) return local;
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using (var baseKey = RegistryKey.OpenBaseKey(hive, view))
            using (var python = baseKey.OpenSubKey(@"Software\Python\PythonCore"))
            {
                if (python == null) continue;
                var versions = python.GetSubKeyNames(); Array.Sort(versions); Array.Reverse(versions);
                foreach (var version in versions)
                using (var install = python.OpenSubKey(version + @"\InstallPath"))
                {
                    if (install == null) continue;
                    var path = Path.Combine(Convert.ToString(install.GetValue("")), "pythonw.exe");
                    if (File.Exists(path)) return path;
                }
            }
        }
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { var path = Path.Combine(directory.Trim('"'), "pythonw.exe"); if (File.Exists(path)) return path; }
            catch (ArgumentException) { }
        }
        throw new InvalidOperationException("Python could not be found. Keep Python 3.12 or newer installed, then open Google Desk again.");
    }

    static Dictionary<string, object> Control()
    {
        var plain = ProtectedData.Unprotect(File.ReadAllBytes(ControlFile), null, DataProtectionScope.CurrentUser);
        return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(plain));
    }

    static bool Call(string endpoint, bool post)
    {
        try
        {
            var control = Control();
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Convert.ToInt32(control["port"]) + "/api/" + endpoint);
            request.Proxy = null; request.Timeout = 2000;
            request.Headers["Authorization"] = "Bearer " + Convert.ToString(control["admin_key"]);
            if (post) { request.Method = "POST"; request.ContentType = "application/json"; var body = Encoding.UTF8.GetBytes("{}"); request.ContentLength = body.Length; using (var stream = request.GetRequestStream()) stream.Write(body, 0, body.Length); }
            using (var response = request.GetResponse()) return true;
        }
        catch { return false; }
    }

    static bool IsAutostart()
    {
        using (var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
            return run != null && Convert.ToString(run.GetValue(RunName)) == Quote(Application.ExecutablePath) + " --background";
    }

    static void SetAutostart(bool enabled)
    {
        using (var run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
        {
            if (enabled) run.SetValue(RunName, Quote(Application.ExecutablePath) + " --background");
            else run.DeleteValue(RunName, false);
        }
    }

    static void Error(string message) { MessageBox.Show(message, "Google Desk", MessageBoxButtons.OK, MessageBoxIcon.Information); }

    static void OpenDesk()
    {
        if (!Call("open-setup", true)) Error("Google Desk is still starting. Try again in a moment. If an older CMD helper is running, stop it once before starting this version.");
    }

    static void Stop()
    {
        if (stopping) return; stopping = true;
        if (timer != null) timer.Stop();
        Call("shutdown", true);
        if (child != null && !child.HasExited && !child.WaitForExit(2500)) child.Kill();
        if (icon != null) { icon.Visible = false; icon.Dispose(); }
        Application.ExitThread();
    }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (Array.IndexOf(args, "--self-test") >= 0)
        {
            // Build check: locate Python and validate argument handling, without starting services or changing startup.
            FindPython();
            if (Quote("C:\\A Folder\\") != "\"C:\\A Folder\\\\\"") return 2;
            return 0;
        }
        if (Array.IndexOf(args, "--smoke-test") >= 0)
        {
            // Isolated launch test. Never use the live widget's port or saved account folder.
            if (Environment.GetEnvironmentVariable("GOOGLE_DESK_DATA_DIR") == null) return 3;
            var smoke = new ProcessStartInfo(FindPython(), Quote(Path.Combine(Root, "companion", "server.py")) + " --no-browser --port 8878 --data-dir " + Quote(Data) + " --desktop-control-file " + Quote(ControlFile));
            smoke.WorkingDirectory = Root; smoke.UseShellExecute = false; smoke.CreateNoWindow = true; smoke.WindowStyle = ProcessWindowStyle.Hidden;
            using (var process = Process.Start(smoke))
            {
                try
                {
                    bool healthy = false;
                    for (int i = 0; i < 40 && !process.HasExited; i++)
                    {
                        if (Call("status", false)) { healthy = true; break; }
                        Thread.Sleep(100);
                    }
                    if (!healthy) return 4;
                    if (!Call("shutdown", true)) return 5;
                    return process.WaitForExit(5000) && !File.Exists(ControlFile) ? 0 : 6;
                }
                finally { if (!process.HasExited) process.Kill(); }
            }
        }
        bool created;
        instance = new Mutex(true, @"Local\GoogleDesk-" + Identity(Root), out created);
        if (!created)
        {
            if (Array.IndexOf(args, "--background") < 0) OpenDesk();
            instance.Dispose(); return 0;
        }
        try
        {
            if (Call("status", false))
            {
                if (Array.IndexOf(args, "--background") < 0) OpenDesk();
                return 0;
            }
            openWhenReady = Array.IndexOf(args, "--background") < 0;
            var start = new ProcessStartInfo(FindPython(), Quote(Path.Combine(Root, "companion", "server.py")) + " --no-browser --data-dir " + Quote(Data) + " --desktop-control-file " + Quote(ControlFile));
            start.WorkingDirectory = Root; start.UseShellExecute = false; start.CreateNoWindow = true; start.WindowStyle = ProcessWindowStyle.Hidden;
            child = Process.Start(start);
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Google Desk", null, delegate { OpenDesk(); });
            menu.Items.Add("Install paired iCUE widget...", null, delegate { if (!Call("widget/install", true)) Error("Could not create the paired widget. Check that the current app and Google-Desk.icuewidget template are in the same folder."); });
            var startup = new ToolStripMenuItem("Start with Windows"); startup.Checked = IsAutostart();
            startup.Click += delegate { try { SetAutostart(!startup.Checked); startup.Checked = IsAutostart(); } catch { Error("Windows could not update the startup setting."); } };
            menu.Items.Add(startup);
            menu.Items.Add("Keep running while the widget is in use") .Enabled = false;
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit Google Desk", null, delegate { Stop(); });
            icon = new NotifyIcon { Icon = SystemIcons.Application, Text = "Google Desk — starting", ContextMenuStrip = menu, Visible = true };
            icon.DoubleClick += delegate { OpenDesk(); };
            timer = new System.Windows.Forms.Timer { Interval = 500 };
            timer.Tick += delegate
            {
                if (child.HasExited)
                {
                    if (!stopping) Error("The local helper stopped. If the old CMD helper is running, stop it and open Google Desk.exe again. Your saved account connection stays in the data folder.");
                    Stop(); return;
                }
                if (!ready)
                {
                    if (Call("status", false))
                    {
                        ready = true; icon.Text = "Google Desk — connected locally";
                        if (openWhenReady) OpenDesk();
                    }
                    else if (++ticks > 60) { Error("The local helper could not start. Check Python and whether port 8765 is already in use."); Stop(); }
                }
            };
            timer.Start(); Application.ApplicationExit += delegate { Stop(); }; Application.Run();
            return 0;
        }
        catch (Exception ex) { Error("Google Desk could not start. " + ex.Message); return 1; }
        finally { if (instance != null) { instance.ReleaseMutex(); instance.Dispose(); } }
    }
}
