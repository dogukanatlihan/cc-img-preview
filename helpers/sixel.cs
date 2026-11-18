// cc-img's Sixel painter for Windows Terminal.
//
// Claude Code gives a mod no way to draw Sixel, the only picture protocol
// Windows Terminal has. So the mod reserves rows of the transcript for a
// picture and writes a small marker at the start of each; this program, run
// in the background for one Claude Code session, reads that session's screen,
// finds the markers, and paints the picture over those rows itself.
//
// It only ever writes: a Sixel picture over rows that carry a marker, and an
// erase of blank cells where a picture it painted earlier has moved away.
//
// Compiled by PowerShell's Add-Type, so it keeps to C# 5.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace CcImg {
  public static class Native {
    [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public short Left; public short Top; public short Right; public short Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct INFO { public COORD Size; public COORD Cursor; public ushort Attr; public RECT Window; public COORD Max; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PROCESSENTRY32 {
      public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
      public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleScreenBufferInfo(IntPtr handle, out INFO info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool ReadConsoleOutputCharacterW(IntPtr handle, [Out] char[] buffer, uint length, COORD at, out uint read);
    /// One cell of the screen: its character, and its colours as the old console knew them.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct CHAR_INFO { public char Char; public ushort Attributes; }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool ReadConsoleOutputW(IntPtr handle, [Out] CHAR_INFO[] buffer, COORD size, COORD from, ref RECT region);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool WriteFile(IntPtr handle, byte[] buffer, uint length, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint milliseconds);
    [DllImport("winmm.dll")] public static extern uint timeEndPeriod(uint milliseconds);

    public static readonly IntPtr Invalid = new IntPtr(-1);

    /// The console's screen, for reading and writing.
    public static IntPtr OpenScreen() {
      return CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    }

    /// Every process now, by its id.
    static Dictionary<uint, PROCESSENTRY32> Snapshot() {
      Dictionary<uint, PROCESSENTRY32> all = new Dictionary<uint, PROCESSENTRY32>();
      IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
      if (snapshot == Invalid) return all;
      try {
        PROCESSENTRY32 entry = new PROCESSENTRY32();
        entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        if (Process32FirstW(snapshot, ref entry)) {
          do { all[entry.th32ProcessID] = entry; } while (Process32NextW(snapshot, ref entry));
        }
      } finally { CloseHandle(snapshot); }
      return all;
    }

    static bool IsProgram(PROCESSENTRY32 entry, string name) {
      return string.Equals(entry.szExeFile, name + ".exe", StringComparison.OrdinalIgnoreCase);
    }

    /// Every process whose program is `name`.exe and which runs, at any depth,
    /// under a process whose program is `under`.exe: a herdr window in Windows
    /// Terminal, and not herdr's server, which runs under nothing.
    public static int[] FindUnder(string name, string under) {
      Dictionary<uint, PROCESSENTRY32> all = Snapshot();
      List<int> found = new List<int>();
      foreach (PROCESSENTRY32 one in all.Values) {
        if (!IsProgram(one, name)) continue;
        uint id = one.th32ParentProcessID;
        for (int hops = 0; hops < 16; hops++) {
          PROCESSENTRY32 parent;
          if (!all.TryGetValue(id, out parent)) break;
          if (IsProgram(parent, under)) { found.Add((int)one.th32ProcessID); break; }
          // A process listed as its own parent (the system's first ones) ends the chain.
          if (parent.th32ParentProcessID == id) break;
          id = parent.th32ParentProcessID;
        }
      }
      return found.ToArray();
    }

    /// The nearest ancestor of this process whose program is `name`.exe; 0 when there is none.
    public static int FindAncestor(string name) {
      Dictionary<uint, PROCESSENTRY32> all = Snapshot();
      uint id = (uint)Process.GetCurrentProcess().Id;
      for (int hops = 0; hops < 16; hops++) {
        PROCESSENTRY32 self;
        if (!all.TryGetValue(id, out self)) return 0;
        PROCESSENTRY32 parent;
        if (!all.TryGetValue(self.th32ParentProcessID, out parent)) return 0;
        if (string.Equals(parent.szExeFile, name + ".exe", StringComparison.OrdinalIgnoreCase)) return (int)parent.th32ProcessID;
        id = parent.th32ProcessID;
      }
      return 0;
    }
  }

  /// A picture's pixels: B, G, R bytes, `Stride` bytes a row.
  public sealed class Picture {
    public int Width; public int Height; public int Stride; public byte[] Pixels; public DateTime Stamp;

    public static Picture Load(string path) {
      // Read whole and closed at once, so the file is never held open.
      using (MemoryStream stream = new MemoryStream(File.ReadAllBytes(path)))
      using (Bitmap bitmap = new Bitmap(stream)) {
        Picture picture = new Picture();
        picture.Width = bitmap.Width;
        picture.Height = bitmap.Height;
        BitmapData data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        picture.Stride = data.Stride;
        picture.Pixels = new byte[data.Stride * bitmap.Height];
        Marshal.Copy(data.Scan0, picture.Pixels, 0, picture.Pixels.Length);
        bitmap.UnlockBits(data);
        picture.Stamp = File.GetLastWriteTimeUtc(path);
        return picture;
      }
    }
  }

  public static class Sixel {
    // A fixed palette: 6 levels of red, 7 of green, 6 of blue.
    const int R = 6, G = 7, B = 6;

    /// Rows `top` to `top + height` of the picture as a Sixel string: palette
    /// colours, dithered, six pixel rows to a band.
    public static string Encode(Picture picture, int top, int height) {
      int w = picture.Width, h = height;
      byte[] index = new byte[w * h];
      double[] now = new double[(w + 2) * 3];
      double[] next = new double[(w + 2) * 3];
      bool[] used = new bool[R * G * B];
      int[] levels = { R, G, B };
      int[] level = new int[3];

      // Floyd-Steinberg: each pixel takes the nearest palette colour and hands its error on.
      for (int y = 0; y < h; y++) {
        Array.Clear(next, 0, next.Length);
        for (int x = 0; x < w; x++) {
          int at = (top + y) * picture.Stride + x * 3;
          for (int c = 0; c < 3; c++) {
            // Pixels are B, G, R; c is 0 red, 1 green, 2 blue.
            double want = picture.Pixels[at + 2 - c] + now[(x + 1) * 3 + c];
            int steps = levels[c] - 1;
            int picked = (int)Math.Round(Math.Max(0.0, Math.Min(255.0, want)) * steps / 255.0);
            level[c] = picked;
            double error = want - picked * 255.0 / steps;
            now[(x + 2) * 3 + c] += error * 7 / 16;
            next[x * 3 + c] += error * 3 / 16;
            next[(x + 1) * 3 + c] += error * 5 / 16;
            next[(x + 2) * 3 + c] += error * 1 / 16;
          }
          int colour = (level[0] * G + level[1]) * B + level[2];
          index[y * w + x] = (byte)colour;
          used[colour] = true;
        }
        double[] swap = now; now = next; next = swap;
      }

      StringBuilder text = new StringBuilder(w * h / 2);
      // DCS with P2 = 1: pixels not drawn stay as they are. Then 1:1 pixels and the size.
      text.Append("\x1bP0;1;0q\"1;1;").Append(w).Append(';').Append(h);
      for (int colour = 0; colour < used.Length; colour++) {
        if (!used[colour]) continue;
        text.Append('#').Append(colour).Append(";2;")
          .Append(colour / (G * B) * 100 / (R - 1)).Append(';')
          .Append(colour / B % G * 100 / (G - 1)).Append(';')
          .Append(colour % B * 100 / (B - 1));
      }

      byte[][] masks = new byte[R * G * B][];
      List<int> inBand = new List<int>();
      for (int bandTop = 0; bandTop < h; bandTop += 6) {
        inBand.Clear();
        for (int bit = 0; bit < 6 && bandTop + bit < h; bit++) {
          for (int x = 0; x < w; x++) {
            int colour = index[(bandTop + bit) * w + x];
            if (masks[colour] == null) { masks[colour] = new byte[w]; inBand.Add(colour); }
            masks[colour][x] |= (byte)(1 << bit);
          }
        }
        for (int n = 0; n < inBand.Count; n++) {
          byte[] mask = masks[inBand[n]];
          masks[inBand[n]] = null;
          if (n > 0) text.Append('$');
          text.Append('#').Append(inBand[n]);
          int end = w;
          while (end > 0 && mask[end - 1] == 0) end--;
          for (int x = 0; x < end; ) {
            int run = 1;
            while (x + run < end && mask[x + run] == mask[x]) run++;
            char symbol = (char)(63 + mask[x]);
            if (run > 3) text.Append('!').Append(run).Append(symbol); else text.Append(symbol, run);
            x += run;
          }
        }
        if (bandTop + 6 < h) text.Append('-');
      }
      text.Append("\x1b\\");
      return text.ToString();
    }
  }

  /// Some rows of one picture, where they are on screen now.
  public sealed class Placement {
    public string Id; public int Column; public int Row; public int First; public int Count; public int Columns;

    public string Key() { return Id + "@" + Column + "," + Row + ":" + First + "+" + Count; }

    public bool Covers(int row, int column) {
      return row >= Row && row < Row + Count && column >= Column && column < Column + Columns;
    }
  }

  public static class Watcher {
    // Windows Terminal draws Sixel as if every cell were 10 by 20 pixels, whatever the font.
    public const int CellWidth = 10;
    public const int CellHeight = 20;
    /// How long between two looks at the screen: while pictures are moving,
    /// while they stand still, and while there is none to be seen.
    const int MovingMs = 3;
    const int StillMs = 12;
    const int EmptyMs = 40;
    /// Pictures are taken to be moving for this long after they last moved.
    const int SettleMs = 1500;
    /// Claude Code may redraw a cell under a picture at any time, which wipes it there: paint again this often.
    const int RepaintMs = 1500;
    /// A picture painted while Claude Code was still drawing the same change may have lost rows to it: paint once more this soon after.
    const int ConfirmMs = 160;

    // The marker's characters are spelled by number, so this file reads the
    // same whatever encoding the compiler takes it for.
    const char Bar = (char)0x2595;
    const char BrailleFirst = (char)0x2800;
    const char BrailleLast = (char)0x28FF;

    /// `<row><U+2595><name>`: row `<row>` of a picture belongs on this screen
    /// row, from this column. `<row>` is one braille character, the row's
    /// number past U+2800; `<name>` is three more, the three bytes whose six
    /// hex digits name the picture's file. As hooks/draw.tsx writes it.
    /// A name an earlier version gave is written out, up to a U+258F.
    static readonly string Braille = "[" + BrailleFirst + "-" + BrailleLast + "]";
    static readonly Regex Marker = new Regex("(" + Braille + ")" + Bar + "(?:(" + Braille + "{3})|([a-z0-9]{2,16})" + (char)0x258F + ")", RegexOptions.Compiled);

    static readonly Dictionary<string, Picture> Pictures = new Dictionary<string, Picture>();
    static readonly Dictionary<string, byte[]> Encoded = new Dictionary<string, byte[]>();
    /// Where each picture's file is, when it was last looked at, and when one that was not found was last looked for.
    static readonly Dictionary<string, string> Paths = new Dictionary<string, string>();
    static readonly Dictionary<string, DateTime> Looked = new Dictionary<string, DateTime>();
    static readonly Dictionary<string, DateTime> Missed = new Dictionary<string, DateTime>();
    static Native.CHAR_INFO[] cells = new Native.CHAR_INFO[0];
    static bool readsWhole = true;

    /// Paints the pictures of the session whose console `consolePid` owns, until
    /// that process ends or a newer painter asks this one to make way.
    /// `version` names the code this painter runs, for the next one to compare.
    public static void Run(string dir, int consolePid, string version) {
      bool isFirst;
      using (Mutex one = new Mutex(true, MutexName(consolePid), out isFirst)) {
        if (!isFirst) { Log(dir, "a painter already runs for " + consolePid); return; }
        Native.FreeConsole();
        if (!Native.AttachConsole((uint)consolePid)) { Log(dir, "cannot attach to console of " + consolePid); return; }
        IntPtr screen = Native.OpenScreen();
        if (screen == Native.Invalid) { Log(dir, "cannot open the screen"); return; }
        try { File.WriteAllText(VersionFile(dir, consolePid), version); } catch { }
        Log(dir, "watching console of " + consolePid + ", version " + version);
        try {
          // What the first look finds, for whoever reads the log.
          Native.INFO first;
          if (Native.GetConsoleScreenBufferInfo(screen, out first)) {
            string[] seen = ReadRows(screen, first);
            int withText = 0;
            foreach (string row in seen) if (row.Trim().Length > 0) withText++;
            Log(dir, "screen " + first.Size.X + " x " + seen.Length + ", " + withText + " rows with text, read " + (readsWhole ? "whole" : "row by row") + ", pictures [" + KeyOf(Find(dir, seen)) + "]");
          }
        } catch (Exception problem) { Log(dir, "first look failed: " + problem.Message); }

        string paintedKey = "";
        DateTime paintedAt = DateTime.MinValue;
        bool isConfirmed = true;
        // With a file named `debug` in the folder, every move is written to the log.
        bool isLogging = File.Exists(Path.Combine(dir, "debug"));
        string stopAll = Path.Combine(dir, "stop");
        string stopThis = StopFile(dir, consolePid);
        DateTime asked = DateTime.MinValue;
        DateTime movedAt = DateTime.MinValue;
        int wait = EmptyMs;
        Process owner;
        try { owner = Process.GetProcessById(consolePid); } catch { return; }
        // Windows wakes a sleeper only every 15 ms or so unless asked for finer.
        Native.timeBeginPeriod(1);

        while (true) {
          // The file system is asked about twice a second, not at every look.
          if ((DateTime.UtcNow - asked).TotalMilliseconds >= 500) {
            asked = DateTime.UtcNow;
            if (owner.HasExited || !Directory.Exists(dir) || File.Exists(stopAll) || File.Exists(stopThis)) break;
          }
          try {
            Native.INFO info;
            if (!Native.GetConsoleScreenBufferInfo(screen, out info)) break;
            string[] rows = ReadRows(screen, info);
            List<Placement> now = Find(dir, rows);
            string key = KeyOf(now);
            double since = (DateTime.UtcNow - paintedAt).TotalMilliseconds;

            if (key != paintedKey) {
              // The pictures moved. Claude Code has cleared the cells they left,
              // by writing them anew: they are painted where they are now.
              Stopwatch took = Stopwatch.StartNew();
              paintedKey = "";
              movedAt = DateTime.UtcNow;
              bool isPainted = now.Count == 0 || Paint(screen, dir, info, now, key);
              if (isPainted) { paintedKey = key; paintedAt = DateTime.UtcNow; isConfirmed = now.Count == 0; }
              if (isLogging) Log(dir, "moved to [" + key + "] " + (isPainted ? "painted" : "not painted: the screen changed again") + ", " + took.ElapsedMilliseconds + " ms");
            } else if (now.Count > 0 && ((!isConfirmed && since >= ConfirmMs) || since >= RepaintMs)) {
              bool isPainted = Paint(screen, dir, info, now, key);
              if (isLogging && !isConfirmed) Log(dir, "confirmed [" + key + "] " + (isPainted ? "painted" : "not painted"));
              if (isPainted) { paintedAt = DateTime.UtcNow; isConfirmed = true; }
            }
            wait = now.Count == 0 ? EmptyMs : (DateTime.UtcNow - movedAt).TotalMilliseconds < SettleMs ? MovingMs : StillMs;
          } catch (Exception problem) {
            Log(dir, problem.GetType().Name + ": " + problem.Message);
          }
          Thread.Sleep(wait);
        }
        Native.timeEndPeriod(1);
        Native.CloseHandle(screen);
        try { File.Delete(VersionFile(dir, consolePid)); } catch { }
        Log(dir, "painter for " + consolePid + " ended");
      }
    }

    /// The version of the painter whose code is the file at `path`: the first
    /// twelve hex digits of its SHA-1, so any change to the code is another version.
    public static string VersionOf(string path) {
      using (System.Security.Cryptography.SHA1 sha = System.Security.Cryptography.SHA1.Create()) {
        byte[] hash = sha.ComputeHash(File.ReadAllBytes(path));
        return BitConverter.ToString(hash, 0, 6).Replace("-", "").ToLowerInvariant();
      }
    }

    public static string MutexName(int consolePid) { return "cc-img-sixel-" + consolePid; }
    /// Holds the version of the painter that runs for this console.
    public static string VersionFile(string dir, int consolePid) { return Path.Combine(dir, "painter-" + consolePid + ".txt"); }
    /// While it is there, the painter for this console ends and none takes its place.
    public static string StopFile(string dir, int consolePid) { return Path.Combine(dir, "stop-" + consolePid); }

    /// Whether a painter runs for this console now.
    public static bool IsRunning(int consolePid) {
      Mutex held;
      if (!Mutex.TryOpenExisting(MutexName(consolePid), out held)) return false;
      held.Dispose();
      return true;
    }

    /// What each row of the screen shows, one character a cell.
    static string[] ReadRows(IntPtr screen, Native.INFO info) {
      int width = info.Size.X;
      int count = info.Window.Bottom - info.Window.Top + 1;
      string[] rows = new string[count];

      if (readsWhole) {
        // The whole screen in one call: one moment of it, and a wide character
        // takes its two cells, so no column is ever out of place.
        if (cells.Length != width * count) cells = new Native.CHAR_INFO[width * count];
        Native.COORD size = new Native.COORD(); size.X = (short)width; size.Y = (short)count;
        Native.COORD from = new Native.COORD();
        Native.RECT region = new Native.RECT();
        region.Left = 0; region.Top = info.Window.Top; region.Right = (short)(width - 1); region.Bottom = info.Window.Bottom;
        if (Native.ReadConsoleOutputW(screen, cells, size, from, ref region)) {
          char[] line = new char[width];
          for (int row = 0; row < count; row++) {
            for (int column = 0; column < width; column++) line[column] = cells[row * width + column].Char;
            rows[row] = new string(line);
          }
          return rows;
        }
        readsWhole = false;
      }

      char[] buffer = new char[width];
      for (int row = 0; row < count; row++) {
        Native.COORD at = new Native.COORD();
        at.X = 0;
        at.Y = (short)(info.Window.Top + row);
        uint read;
        rows[row] = Native.ReadConsoleOutputCharacterW(screen, buffer, (uint)width, at, out read) ? new string(buffer, 0, (int)read) : "";
      }
      return rows;
    }

    /// The pictures on screen: each run of rows that follow one another, on screen and in the picture.
    static List<Placement> Find(string dir, string[] rows) {
      List<Placement> found = new List<Placement>();
      for (int row = 0; row < rows.Length; row++) {
        if (rows[row].IndexOf(Bar) < 0) continue;
        foreach (Match match in Marker.Matches(rows[row])) {
          string id = match.Groups[3].Value;
          if (match.Groups[2].Success) {
            string name = match.Groups[2].Value;
            id = ((name[0] - BrailleFirst) << 16 | (name[1] - BrailleFirst) << 8 | (name[2] - BrailleFirst)).ToString("x6");
          }
          int imageRow = match.Groups[1].Value[0] - BrailleFirst;
          Picture picture = PictureOf(dir, id);
          if (picture == null || imageRow * CellHeight >= picture.Height) continue;

          Placement last = null;
          for (int n = found.Count - 1; n >= 0 && last == null; n--) {
            Placement one = found[n];
            if (one.Id == id && one.Column == match.Index && one.Row + one.Count == row && one.First + one.Count == imageRow) last = one;
          }
          if (last != null) { last.Count++; continue; }

          Placement placement = new Placement();
          placement.Id = id; placement.Column = match.Index; placement.Row = row; placement.First = imageRow; placement.Count = 1;
          placement.Columns = (picture.Width + CellWidth - 1) / CellWidth;
          found.Add(placement);
        }
      }
      return found;
    }

    static string KeyOf(List<Placement> placements) {
      StringBuilder key = new StringBuilder();
      foreach (Placement one in placements) key.Append(one.Key()).Append(' ');
      return key.ToString();
    }

    /// The picture `<id>.six.bmp`, in `dir` or one folder beneath it: the mod
    /// keeps each session's files in a folder of its own.
    static Picture PictureOf(string dir, string id) {
      string path;
      Picture known;
      DateTime seen;
      // A file looked at within the last second is taken to be as it was.
      if (Pictures.TryGetValue(id, out known) && Looked.TryGetValue(id, out seen) && (DateTime.UtcNow - seen).TotalSeconds < 1) return known;
      Looked[id] = DateTime.UtcNow;
      if (!Paths.TryGetValue(id, out path) || !File.Exists(path)) {
        Pictures.Remove(id);
        DateTime looked;
        if (Missed.TryGetValue(id, out looked) && (DateTime.UtcNow - looked).TotalSeconds < 1) return null;
        path = null;
        string name = id + ".six.bmp";
        if (File.Exists(Path.Combine(dir, name))) path = Path.Combine(dir, name);
        else {
          // Should two sessions ever have given a picture the same name, the newest is this one's.
          DateTime newest = DateTime.MinValue;
          foreach (string folder in Directory.GetDirectories(dir)) {
            string candidate = Path.Combine(folder, name);
            if (!File.Exists(candidate)) continue;
            DateTime written = File.GetLastWriteTimeUtc(candidate);
            if (written > newest) { newest = written; path = candidate; }
          }
        }
        if (path == null) { Missed[id] = DateTime.UtcNow; return null; }
        Paths[id] = path;
      }
      Picture held;
      if (Pictures.TryGetValue(id, out held) && held.Stamp == File.GetLastWriteTimeUtc(path)) return held;
      try { held = Picture.Load(path); } catch { return null; }
      Pictures[id] = held;
      return held;
    }

    /// Paints the pictures where `placements` say; false, with nothing painted,
    /// when the screen has changed under them meanwhile.
    static bool Paint(IntPtr screen, string dir, Native.INFO info, List<Placement> placements, string key) {
      int screenRows = info.Window.Bottom - info.Window.Top + 1;
      // Save the cursor, go to each place and paint, put the cursor back: one
      // write for all of it, so nothing of Claude Code's lands in between.
      MemoryStream all = new MemoryStream();
      all.WriteByte(0x1b); all.WriteByte((byte)'7');
      foreach (Placement one in placements) {
        Picture picture = PictureOf(dir, one.Id);
        if (picture == null) continue;
        // A Sixel that runs past the bottom of the screen scrolls everything: the last row is left alone.
        int count = Math.Min(one.Count, screenRows - 1 - one.Row);
        int top = one.First * CellHeight;
        int height = Math.Min(count * CellHeight, picture.Height - top);
        if (count <= 0 || height <= 0) continue;

        string cacheKey = one.Id + "|" + picture.Stamp.Ticks + "|" + top + "|" + height;
        byte[] sixel;
        if (!Encoded.TryGetValue(cacheKey, out sixel)) {
          if (Encoded.Count > 48) Encoded.Clear();
          sixel = Encoding.ASCII.GetBytes(Sixel.Encode(picture, top, height));
          Encoded[cacheKey] = sixel;
        }
        byte[] place = Encoding.ASCII.GetBytes("\x1b[" + (one.Row + 1) + ";" + (one.Column + 1) + "H");
        all.Write(place, 0, place.Length);
        all.Write(sixel, 0, sixel.Length);
      }
      all.WriteByte(0x1b); all.WriteByte((byte)'8');

      // Making the pictures took a moment, and Claude Code may have scrolled in
      // it: painted now, they would land on rows that are no longer their own.
      if (KeyOf(Find(dir, ReadRows(screen, info))) != key) return false;
      byte[] bytes = all.ToArray();
      uint written;
      Native.WriteFile(screen, bytes, (uint)bytes.Length, out written, IntPtr.Zero);

      // And it may have scrolled between that look and the write. Then the
      // pictures lie on rows that are not theirs, where Claude Code clears
      // nothing by itself: what of them lies on blank cells is wiped here.
      string[] after = ReadRows(screen, info);
      List<Placement> lie = Find(dir, after);
      if (KeyOf(lie) == key) return true;
      Erase(screen, after, placements, lie);
      return false;
    }

    /// Wipes the blank cells an earlier picture covered and no picture covers now.
    /// A cell with text in it was written since, which wiped the picture there already.
    static int Erase(IntPtr screen, string[] rows, List<Placement> old, List<Placement> now) {
      int runs = 0;
      StringBuilder text = new StringBuilder();
      foreach (Placement was in old) {
        for (int row = was.Row; row < was.Row + was.Count && row < rows.Length; row++) {
          int from = -1;
          for (int column = was.Column; column <= was.Column + was.Columns; column++) {
            bool isBlank = column < was.Column + was.Columns && (column >= rows[row].Length || rows[row][column] == ' ');
            if (isBlank) {
              foreach (Placement one in now) if (one.Covers(row, column)) { isBlank = false; break; }
            }
            if (isBlank && from < 0) from = column;
            if (!isBlank && from >= 0) {
              // Spaces written over the cells: text written to a cell is known to
              // wipe the picture there. An erase command left pieces behind.
              text.Append("\x1b[").Append(row + 1).Append(';').Append(from + 1).Append('H').Append(' ', column - from);
              from = -1;
              runs++;
            }
          }
        }
      }
      if (text.Length == 0) return 0;
      // The cursor and the colours in use are saved, plain ones taken for the spaces, and all put back.
      byte[] bytes = Encoding.ASCII.GetBytes("\x1b" + "7\x1b[0m" + text.ToString() + "\x1b" + "8");
      uint written;
      Native.WriteFile(screen, bytes, (uint)bytes.Length, out written, IntPtr.Zero);
      return runs;
    }

    static void Log(string dir, string line) {
      try { File.AppendAllText(Path.Combine(dir, "sixel.log"), DateTime.Now.ToString("HH:mm:ss.fff") + " " + line + "\r\n"); } catch { }
    }
  }
}
