# Blink the DSH taskbar button, the way Electron's flashFrame(true) does: keep
# blinking until the window comes to the foreground.
#
# The plugin Host runs as a child of the Electron shell, and the taskbar button
# belongs to the shell's window, so the window is found by walking up from this
# process. There are no parameters: a request can start the blink but cannot
# point it at another application.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class MagpieFlash
{
    [StructLayout(LayoutKind.Sequential)]
    public struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    [DllImport("user32.dll")]
    public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    public static bool Blink(IntPtr hwnd)
    {
        FLASHWINFO info = new FLASHWINFO();
        info.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
        info.hwnd = hwnd;
        // FLASHW_ALL | FLASHW_TIMERNOFG: caption and taskbar, until focused.
        info.dwFlags = 0x0000000F;
        info.uCount = uint.MaxValue;
        info.dwTimeout = 0;
        return FlashWindowEx(ref info);
    }
}
'@

$id = $PID
# Up to 8 hops: the Host may be a grandchild of the shell, and a terminal in
# between (a debug run) adds two more. The first ancestor with a window wins.
for ($hop = 0; $hop -lt 8; $hop++) {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
    if (-not $info) { break }
    $id = [int]$info.ParentProcessId
    if ($id -le 0) { break }
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
        [void][MagpieFlash]::Blink($proc.MainWindowHandle)
        break
    }
}
