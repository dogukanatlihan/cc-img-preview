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
    [StructLayout(LayoutKind.Sequential)] public struct Coord { public short X; public short Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public short Left; public short Top; public short Right; public short Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct ScreenInfo { public Coord Size; public Coord Cursor; public ushort Attr; public Rect Window; public Coord Max; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry {
      public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
      public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    /// One cell of the screen: its character, and its colours as the old console knew them.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct CharInfo { public char Char; public ushort Attributes; }

    // What Windows itself offers. Each is reached through one of the methods below.
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleScreenBufferInfo(IntPtr handle, out ScreenInfo info);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ReadConsoleOutputCharacterW(IntPtr handle, [Out] char[] buffer, uint length, Coord at, out uint read);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ReadConsoleOutputW(IntPtr handle, [Out] CharInfo[] buffer, Coord size, Coord from, ref Rect region);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr handle, byte[] buffer, uint length, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint milliseconds);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint milliseconds);

    public static readonly IntPtr Invalid = new IntPtr(-1);

    /// Leaves the console this process has for the one that process `pid` owns; false when that one cannot be had.
    public static bool AttachTo(int pid) {
      FreeConsole();
      return AttachConsole((uint)pid);
    }

    /// The console's screen, for reading and writing.
    public static IntPtr OpenScreen() {
      return CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    }

    /// How large the screen is, and which of its rows are in view; false for a screen that was never opened.
    public static bool Measure(IntPtr screen, out ScreenInfo info) {
      info = new ScreenInfo();
      return screen != Invalid && screen != IntPtr.Zero && GetConsoleScreenBufferInfo(screen, out info);
    }

    /// Reads `count` rows of `width` cells into `cells`, from row `top` down, in one call.
    public static bool ReadCells(IntPtr screen, CharInfo[] cells, int width, int count, short top) {
      Coord size = new Coord(); size.X = (short)width; size.Y = (short)count;
      Rect region = new Rect();
      region.Left = 0; region.Top = top; region.Right = (short)(width - 1); region.Bottom = (short)(top + count - 1);
      return ReadConsoleOutputW(screen, cells, size, new Coord(), ref region);
    }

    /// The characters of screen row `row`, as many as `buffer` holds; empty when the row cannot be read.
    public static string ReadRow(IntPtr screen, char[] buffer, int row) {
      Coord at = new Coord();
      at.X = 0;
      at.Y = (short)row;
      uint read;
      return ReadConsoleOutputCharacterW(screen, buffer, (uint)buffer.Length, at, out read) ? new string(buffer, 0, (int)read) : "";
    }

    /// Writes `bytes` to the screen in one call.
    public static void Write(IntPtr screen, byte[] bytes) {
      uint written;
      WriteFile(screen, bytes, (uint)bytes.Length, out written, IntPtr.Zero);
    }

    /// Closes what `OpenScreen` opened; a handle that never opened is left alone.
    public static void Close(IntPtr handle) {
      if (handle != Invalid && handle != IntPtr.Zero) CloseHandle(handle);
    }

    /// Windows wakes a sleeper only every 15 ms or so unless asked for finer.
    public static void WakeFinely(bool isOn) {
      if (isOn) timeBeginPeriod(1); else timeEndPeriod(1);
    }

    /// Every process now, by its id.
    static Dictionary<uint, ProcessEntry> Snapshot() {
      Dictionary<uint, ProcessEntry> all = new Dictionary<uint, ProcessEntry>();
      IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
      if (snapshot == Invalid) return all;
      try {
        ProcessEntry entry = new ProcessEntry();
        entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry));
        if (Process32FirstW(snapshot, ref entry)) {
          do { all[entry.th32ProcessID] = entry; } while (Process32NextW(snapshot, ref entry));
        }
      } finally { CloseHandle(snapshot); }
      return all;
    }

    static bool IsProgram(ProcessEntry entry, string name) {
      return string.Equals(entry.szExeFile, name + ".exe", StringComparison.OrdinalIgnoreCase);
    }

    /// Every process whose program is `name`.exe and which runs, at any depth,
    /// under a process whose program is `under`.exe: a herdr window in Windows
    /// Terminal, and not herdr's server, which runs under nothing.
    public static int[] FindUnder(string name, string under) {
      Dictionary<uint, ProcessEntry> all = Snapshot();
      List<int> found = new List<int>();
      foreach (ProcessEntry one in all.Values) {
        if (!IsProgram(one, name)) continue;
        uint id = one.th32ParentProcessID;
        for (int hops = 0; hops < 16; hops++) {
          ProcessEntry parent;
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
      Dictionary<uint, ProcessEntry> all = Snapshot();
      uint id = (uint)Process.GetCurrentProcess().Id;
      for (int hops = 0; hops < 16; hops++) {
        ProcessEntry self;
        if (!all.TryGetValue(id, out self)) return 0;
        ProcessEntry parent;
        if (!all.TryGetValue(self.th32ParentProcessID, out parent)) return 0;
        if (string.Equals(parent.szExeFile, name + ".exe", StringComparison.OrdinalIgnoreCase)) return (int)parent.th32ProcessID;
        id = parent.th32ProcessID;
      }
      return 0;
    }
  }

  /// A picture's pixels: B, G, R bytes, `Stride` bytes a row.
  public sealed class Picture {
    public int Width { get; private set; }
    public int Height { get; private set; }
    public int Stride { get; private set; }
    public byte[] Pixels { get; private set; }
    public DateTime Stamp { get; private set; }

    public Picture(int width, int height, int stride, byte[] pixels, DateTime stamp) {
      Width = width;
      Height = height;
      Stride = stride;
      Pixels = pixels;
      Stamp = stamp;
    }

    public static Picture Load(string path) {
      // Read whole and closed at once, so the file is never held open.
      using (MemoryStream stream = new MemoryStream(File.ReadAllBytes(path)))
      using (Bitmap bitmap = new Bitmap(stream)) {
        BitmapData data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        byte[] pixels = new byte[data.Stride * bitmap.Height];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        bitmap.UnlockBits(data);
        return new Picture(bitmap.Width, bitmap.Height, data.Stride, pixels, File.GetLastWriteTimeUtc(path));
      }
    }
  }

  public static class Sixel {
    // A fixed palette: 6 levels of red, 7 of green, 6 of blue.
    const int R = 6, G = 7, B = 6;
    static readonly int[] Levels = { R, G, B };

    /// Rows `top` to `top + height` of the picture as a Sixel string: palette
    /// colours, dithered, six pixel rows to a band.
    public static string Encode(Picture picture, int top, int height) {
      int w = picture.Width, h = height;
      bool[] used = new bool[R * G * B];
      byte[] index = Dither(picture, top, h, used);

      StringBuilder text = new StringBuilder(w * h / 2);
      // DCS with P2 = 1: pixels not drawn stay as they are. Then 1:1 pixels and the size.
      text.Append("\x1bP0;1;0q\"1;1;").Append(w).Append(';').Append(h);
      AppendPalette(text, used);
      AppendBands(text, index, w, h);
      text.Append("\x1b\\");
      return text.ToString();
    }

    /// The palette colour of each pixel of rows `top` to `top + h`, row by row;
    /// `used` is told which colours there are.
    static byte[] Dither(Picture picture, int top, int h, bool[] used) {
      int w = picture.Width;
      byte[] index = new byte[w * h];
      double[] now = new double[(w + 2) * 3];
      double[] next = new double[(w + 2) * 3];
      int[] level = new int[3];

      // Floyd-Steinberg: each pixel takes the nearest palette colour and hands its error on.
      for (int y = 0; y < h; y++) {
        Array.Clear(next, 0, next.Length);
        for (int x = 0; x < w; x++) {
          int at = (top + y) * picture.Stride + x * 3;
          // Pixels are B, G, R; c is 0 red, 1 green, 2 blue.
          for (int c = 0; c < 3; c++) level[c] = Settle(picture.Pixels[at + 2 - c] + now[(x + 1) * 3 + c], c, x, now, next);
          int colour = (level[0] * G + level[1]) * B + level[2];
          index[y * w + x] = (byte)colour;
          used[colour] = true;
        }
        double[] swap = now; now = next; next = swap;
      }
      return index;
    }

    /// The level of channel `c` nearest to `want`, for the pixel in column `x`.
    /// What it is off by goes to the pixels to its right and beneath it.
    static int Settle(double want, int c, int x, double[] now, double[] next) {
      int steps = Levels[c] - 1;
      int picked = (int)Math.Round(Math.Max(0.0, Math.Min(255.0, want)) * steps / 255.0);
      double error = want - picked * 255.0 / steps;
      now[(x + 2) * 3 + c] += error * 7 / 16;
      next[x * 3 + c] += error * 3 / 16;
      next[(x + 1) * 3 + c] += error * 5 / 16;
      next[(x + 2) * 3 + c] += error * 1 / 16;
      return picked;
    }

    /// The colours in use, each as percentages of red, green and blue.
    static void AppendPalette(StringBuilder text, bool[] used) {
      for (int colour = 0; colour < used.Length; colour++) {
        if (!used[colour]) continue;
        text.Append('#').Append(colour).Append(";2;")
          .Append(colour / (G * B) * 100 / (R - 1)).Append(';')
          .Append(colour / B % G * 100 / (G - 1)).Append(';')
          .Append(colour % B * 100 / (B - 1));
      }
    }

    /// The pixels, six rows to a band: in each band, one pass for every colour it holds.
    static void AppendBands(StringBuilder text, byte[] index, int w, int h) {
      byte[][] masks = new byte[R * G * B][];
      List<int> inBand = new List<int>();
      for (int bandTop = 0; bandTop < h; bandTop += 6) {
        inBand.Clear();
        MaskBand(index, w, h, bandTop, masks, inBand);
        for (int n = 0; n < inBand.Count; n++) {
          byte[] mask = masks[inBand[n]];
          masks[inBand[n]] = null;
          if (n > 0) text.Append('$');
          text.Append('#').Append(inBand[n]);
          AppendRuns(text, mask, w);
        }
        if (bandTop + 6 < h) text.Append('-');
      }
    }

    /// For each colour in the band from `bandTop`: which of its six rows hold
    /// that colour, column by column. `inBand` lists the colours, first seen first.
    static void MaskBand(byte[] index, int w, int h, int bandTop, byte[][] masks, List<int> inBand) {
      for (int bit = 0; bit < 6 && bandTop + bit < h; bit++) {
        for (int x = 0; x < w; x++) {
          int colour = index[(bandTop + bit) * w + x];
          if (masks[colour] == null) { masks[colour] = new byte[w]; inBand.Add(colour); }
          masks[colour][x] |= (byte)(1 << bit);
        }
      }
    }

    /// One colour's pass over a band: a character a column, a run of four or
    /// more written as its length, and nothing for what is empty at the end.
    static void AppendRuns(StringBuilder text, byte[] mask, int w) {
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
  }

  /// Some rows of one picture, where they are on screen now.
  public sealed class Placement {
    public string Id { get; private set; }
    public int Column { get; private set; }
    public int Row { get; private set; }
    public int First { get; private set; }
    public int Count { get; private set; }
    public int Columns { get; private set; }

    /// Row `first` of picture `id`, on screen row `row` from column `column`, `columns` cells wide.
    public Placement(string id, int column, int row, int first, int columns) {
      Id = id;
      Column = column;
      Row = row;
      First = first;
      Count = 1;
      Columns = columns;
    }

    public string Key() { return Id + "@" + Column + "," + Row + ":" + First + "+" + Count; }

    public bool Covers(int row, int column) {
      return row >= Row && row < Row + Count && column >= Column && column < Column + Columns;
    }

    /// Whether row `first` of picture `id`, on screen row `row` from `column`, is the next row of these.
    public bool IsFollowedBy(string id, int column, int row, int first) {
      return Id == id && Column == column && Row + Count == row && First + Count == first;
    }

    /// Takes the next row in.
    public void Extend() { Count++; }
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
    /// The expression reads a row once through; the time limit is there so that no row can ever hold the painter up.
    static readonly Regex Marker = new Regex("(" + Braille + ")" + Bar + "(?:(" + Braille + "{3})|([a-z0-9]{2,16})" + (char)0x258F + ")", RegexOptions.Compiled, TimeSpan.FromSeconds(1));

    static readonly Dictionary<string, Picture> Pictures = new Dictionary<string, Picture>();
    static readonly Dictionary<string, byte[]> Encoded = new Dictionary<string, byte[]>();
    /// Where each picture's file is, when it was last looked at, and when one that was not found was last looked for.
    static readonly Dictionary<string, string> Paths = new Dictionary<string, string>();
    static readonly Dictionary<string, DateTime> Looked = new Dictionary<string, DateTime>();
    static readonly Dictionary<string, DateTime> Missed = new Dictionary<string, DateTime>();
    static Native.CharInfo[] cells = new Native.CharInfo[0];
    static bool readsWhole = true;

    // What the painter knows from one look at the screen to the next: which
    // pictures it last painted and when, whether that painting was looked at
    // again, and when the pictures last moved.
    static string paintedKey = "";
    static DateTime paintedAt = DateTime.MinValue;
    static bool isConfirmed = true;
    static DateTime movedAt = DateTime.MinValue;
    static bool isLogging;

    /// Paints the pictures of the session whose console `consolePid` owns, until
    /// that process ends or a newer painter asks this one to make way.
    /// `version` names the code this painter runs, for the next one to compare.
    public static void Run(string dir, int consolePid, string version) {
      bool isFirst;
      using (Mutex one = new Mutex(true, MutexName(consolePid), out isFirst)) {
        if (!isFirst) { Log(dir, "a painter already runs for " + consolePid); return; }
        if (!Native.AttachTo(consolePid)) { Log(dir, "cannot attach to console of " + consolePid); return; }
        IntPtr screen = Native.OpenScreen();
        if (screen == Native.Invalid) { Log(dir, "cannot open the screen"); return; }
        try { File.WriteAllText(VersionFile(dir, consolePid), version); }
        catch {
          // The painter paints without the file: it only tells the next start which version runs.
        }
        Log(dir, "watching console of " + consolePid + ", version " + version);
        LogFirstLook(dir, screen);

        // With a file named `debug` in the folder, every move is written to the log.
        isLogging = File.Exists(Path.Combine(dir, "debug"));
        Process owner;
        try { owner = Process.GetProcessById(consolePid); } catch { return; }
        Watch(dir, screen, owner, StopFile(dir, consolePid));

        Native.Close(screen);
        try { File.Delete(VersionFile(dir, consolePid)); }
        catch {
          // A file left behind names a painter that no longer runs, and the next start finds that out by itself.
        }
        Log(dir, "painter for " + consolePid + " ended");
      }
    }

    /// What the first look finds, for whoever reads the log.
    static void LogFirstLook(string dir, IntPtr screen) {
      try {
        Native.ScreenInfo first;
        if (!Native.Measure(screen, out first)) return;
        string[] seen = ReadRows(screen, first);
        int withText = 0;
        foreach (string row in seen) if (row.Trim().Length > 0) withText++;
        Log(dir, "screen " + first.Size.X + " x " + seen.Length + ", " + withText + " rows with text, read " + (readsWhole ? "whole" : "row by row") + ", pictures [" + KeyOf(Find(dir, seen)) + "]");
      } catch (Exception problem) { Log(dir, "first look failed: " + problem.Message); }
    }

    /// Looks at the screen again and again, and paints, until the console's
    /// owner ends, the folder goes, or a stop file appears.
    static void Watch(string dir, IntPtr screen, Process owner, string stopThis) {
      string stopAll = Path.Combine(dir, "stop");
      DateTime asked = DateTime.MinValue;
      int wait = EmptyMs;
      // Windows wakes a sleeper only every 15 ms or so unless asked for finer.
      Native.WakeFinely(true);

      while (true) {
        // The file system is asked about twice a second, not at every look.
        if ((DateTime.UtcNow - asked).TotalMilliseconds >= 500) {
          asked = DateTime.UtcNow;
          if (owner.HasExited || !Directory.Exists(dir) || File.Exists(stopAll) || File.Exists(stopThis)) break;
        }
        try {
          Native.ScreenInfo info;
          if (!Native.Measure(screen, out info)) break;
          wait = Look(dir, screen, info);
        } catch (Exception problem) {
          Log(dir, problem.GetType().Name + ": " + problem.Message);
        }
        Thread.Sleep(wait);
      }
      Native.WakeFinely(false);
    }

    /// One look at the screen: paints the pictures that moved, or that are due
    /// to be painted again. Answers how long to wait before the next look.
    static int Look(string dir, IntPtr screen, Native.ScreenInfo info) {
      string[] rows = ReadRows(screen, info);
      List<Placement> now = Find(dir, rows);
      string key = KeyOf(now);
      double since = (DateTime.UtcNow - paintedAt).TotalMilliseconds;

      if (key != paintedKey) PaintMoved(dir, screen, info, now, key);
      else if (now.Count > 0 && ((!isConfirmed && since >= ConfirmMs) || since >= RepaintMs)) PaintAgain(dir, screen, info, now, key);

      if (now.Count == 0) return EmptyMs;
      return (DateTime.UtcNow - movedAt).TotalMilliseconds < SettleMs ? MovingMs : StillMs;
    }

    /// The pictures moved. Claude Code has cleared the cells they left,
    /// by writing them anew: they are painted where they are now.
    static void PaintMoved(string dir, IntPtr screen, Native.ScreenInfo info, List<Placement> now, string key) {
      Stopwatch took = Stopwatch.StartNew();
      paintedKey = "";
      movedAt = DateTime.UtcNow;
      bool isPainted = now.Count == 0 || Paint(screen, dir, info, now, key);
      if (isPainted) { paintedKey = key; paintedAt = DateTime.UtcNow; isConfirmed = now.Count == 0; }
      if (isLogging) Log(dir, "moved to [" + key + "] " + (isPainted ? "painted" : "not painted: the screen changed again") + ", " + took.ElapsedMilliseconds + " ms");
    }

    /// The pictures stand where they were painted, and are painted there once more.
    static void PaintAgain(string dir, IntPtr screen, Native.ScreenInfo info, List<Placement> now, string key) {
      bool isPainted = Paint(screen, dir, info, now, key);
      if (isLogging && !isConfirmed) Log(dir, "confirmed [" + key + "] " + (isPainted ? "painted" : "not painted"));
      if (isPainted) { paintedAt = DateTime.UtcNow; isConfirmed = true; }
    }

    /// The version of the painter whose code is the file at `path`: the first
    /// twelve hex digits of its SHA-256, so any change to the code is another version.
    public static string VersionOf(string path) {
      using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create()) {
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
    static string[] ReadRows(IntPtr screen, Native.ScreenInfo info) {
      int width = info.Size.X;
      int count = info.Window.Bottom - info.Window.Top + 1;
      string[] rows = new string[count];

      if (readsWhole) {
        // The whole screen in one call: one moment of it, and a wide character
        // takes its two cells, so no column is ever out of place.
        if (cells.Length != width * count) cells = new Native.CharInfo[width * count];
        if (Native.ReadCells(screen, cells, width, count, info.Window.Top)) {
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
      for (int row = 0; row < count; row++) rows[row] = Native.ReadRow(screen, buffer, info.Window.Top + row);
      return rows;
    }

    /// The pictures on screen: each run of rows that follow one another, on screen and in the picture.
    static List<Placement> Find(string dir, string[] rows) {
      List<Placement> found = new List<Placement>();
      for (int row = 0; row < rows.Length; row++) {
        if (rows[row].IndexOf(Bar) < 0) continue;
        foreach (Match match in Marker.Matches(rows[row])) Place(dir, found, match, row);
      }
      return found;
    }

    /// Takes in the picture row one marker names, found on screen row `row`:
    /// as the next row of the run it follows, or as the first row of a new one.
    static void Place(string dir, List<Placement> found, Match match, int row) {
      string id = IdOf(match);
      int imageRow = match.Groups[1].Value[0] - BrailleFirst;
      Picture picture = PictureOf(dir, id);
      if (picture == null || imageRow * CellHeight >= picture.Height) return;

      int column = match.Index;
      Placement last = found.FindLast(one => one.IsFollowedBy(id, column, row, imageRow));
      if (last != null) { last.Extend(); return; }
      found.Add(new Placement(id, column, row, imageRow, (picture.Width + CellWidth - 1) / CellWidth));
    }

    /// The name of the picture a marker belongs to.
    static string IdOf(Match match) {
      if (!match.Groups[2].Success) return match.Groups[3].Value;
      string name = match.Groups[2].Value;
      return ((name[0] - BrailleFirst) << 16 | (name[1] - BrailleFirst) << 8 | (name[2] - BrailleFirst)).ToString("x6");
    }

    static string KeyOf(List<Placement> placements) {
      StringBuilder key = new StringBuilder();
      foreach (Placement one in placements) key.Append(one.Key()).Append(' ');
      return key.ToString();
    }

    /// The picture `<id>.six.bmp`, in `dir` or one folder beneath it: the mod
    /// keeps each session's files in a folder of its own.
    static Picture PictureOf(string dir, string id) {
      Picture known;
      DateTime seen;
      // A file looked at within the last second is taken to be as it was.
      if (Pictures.TryGetValue(id, out known) && Looked.TryGetValue(id, out seen) && (DateTime.UtcNow - seen).TotalSeconds < 1) return known;
      Looked[id] = DateTime.UtcNow;
      string path = PathOf(dir, id);
      if (path == null) return null;

      Picture held;
      if (Pictures.TryGetValue(id, out held) && held.Stamp == File.GetLastWriteTimeUtc(path)) return held;
      try { held = Picture.Load(path); } catch { return null; }
      Pictures[id] = held;
      return held;
    }

    /// Where the file of picture `id` is; null when there is none. A file that
    /// was not found is looked for again a second later, not sooner.
    static string PathOf(string dir, string id) {
      string path;
      if (Paths.TryGetValue(id, out path) && File.Exists(path)) return path;

      Pictures.Remove(id);
      DateTime looked;
      if (Missed.TryGetValue(id, out looked) && (DateTime.UtcNow - looked).TotalSeconds < 1) return null;
      path = Locate(dir, id + ".six.bmp");
      if (path == null) Missed[id] = DateTime.UtcNow; else Paths[id] = path;
      return path;
    }

    /// The file `name` in `dir`, or in a folder of `dir`; null when there is none.
    static string Locate(string dir, string name) {
      if (File.Exists(Path.Combine(dir, name))) return Path.Combine(dir, name);

      // Should two sessions ever have given a picture the same name, the newest is this one's.
      string path = null;
      DateTime newest = DateTime.MinValue;
      foreach (string folder in Directory.GetDirectories(dir)) {
        string candidate = Path.Combine(folder, name);
        if (!File.Exists(candidate)) continue;
        DateTime written = File.GetLastWriteTimeUtc(candidate);
        if (written > newest) { newest = written; path = candidate; }
      }
      return path;
    }

    /// Paints the pictures where `placements` say; false, with nothing painted,
    /// when the screen has changed under them meanwhile.
    static bool Paint(IntPtr screen, string dir, Native.ScreenInfo info, List<Placement> placements, string key) {
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
      Native.Write(screen, all.ToArray());

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
    static void Erase(IntPtr screen, string[] rows, List<Placement> old, List<Placement> now) {
      StringBuilder text = new StringBuilder();
      foreach (Placement was in old) {
        for (int row = was.Row; row < was.Row + was.Count && row < rows.Length; row++) AppendErase(text, rows[row], row, was, now);
      }
      if (text.Length == 0) return;
      // The cursor and the colours in use are saved, plain ones taken for the spaces, and all put back.
      Native.Write(screen, Encoding.ASCII.GetBytes("\x1b" + "7\x1b[0m" + text.ToString() + "\x1b" + "8"));
    }

    /// One screen row of an earlier picture: what wipes each stretch of its
    /// cells that is blank in `line` and under no picture now.
    static void AppendErase(StringBuilder text, string line, int row, Placement was, List<Placement> now) {
      int end = was.Column + was.Columns;
      int from = -1;
      for (int column = was.Column; column <= end; column++) {
        bool isBlank = column < end && IsBlank(line, column) && !now.Exists(one => one.Covers(row, column));
        if (isBlank && from < 0) from = column;
        if (!isBlank && from >= 0) {
          // Spaces written over the cells: text written to a cell is known to
          // wipe the picture there. An erase command left pieces behind.
          text.Append("\x1b[").Append(row + 1).Append(';').Append(from + 1).Append('H').Append(' ', column - from);
          from = -1;
        }
      }
    }

    static bool IsBlank(string line, int column) {
      return column >= line.Length || line[column] == ' ';
    }

    static void Log(string dir, string line) {
      try { File.AppendAllText(Path.Combine(dir, "sixel.log"), DateTime.Now.ToString("HH:mm:ss.fff") + " " + line + "\r\n"); }
      catch {
        // A line that cannot be written is done without: the log is the only place the painter has to say so.
      }
    }
  }
}
