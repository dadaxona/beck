'use strict';

/**
 * USB printer (Windows drayveri o'rnatilgan): ESC/POS baytlari Windows printer navbatiga
 * RAW ko'rinishida yuboriladi (winspool.drv: OpenPrinter → StartDocPrinter "RAW" → WritePrinter).
 *
 * Native modul kerak emas: yordamchi C# kodi bir marta DLL ga kompilyatsiya qilinadi
 * (userData papkasida) va PowerShell orqali chaqiriladi.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CS_SOURCE = `
using System;
using System.Runtime.InteropServices;
public static class OneCRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

  public static string Send(string printer, string file) {
    byte[] bytes = System.IO.File.ReadAllBytes(file);
    IntPtr h;
    int jobId = 0;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OPEN:" + Marshal.GetLastWin32Error();
    try {
      DOCINFO info = new DOCINFO { pDocName = "2C chek", pDataType = "RAW" };
      jobId = StartDocPrinter(h, 1, info);
      if (jobId == 0) return "DOC:" + Marshal.GetLastWin32Error();
      try {
        StartPagePrinter(h);
        int written;
        bool ok = WritePrinter(h, bytes, bytes.Length, out written);
        EndPagePrinter(h);
        if (!ok || written != bytes.Length) return "WRITE:" + Marshal.GetLastWin32Error();
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return "OK:" + jobId;
  }
}`;

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
# 1) Printer bormi va USB porti bo'lsa — qurilma haqiqatan ulanganmi?
$pr = Get-Printer -Name $env:ONEC_PRINTER -ErrorAction SilentlyContinue
if (-not $pr) { 'OPEN:1801'; exit }
if ($pr.PortName -match '^USB(\\d+)$') {
  # USB00N porti qaysi fizik qurilmaga tegishli — USB printer port interfeysi reestridan (Port Number)
  $num = [int]$Matches[1]
  $root = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceClasses\\{28d78fad-5a12-11d1-ae5b-0000f803a8c2}'
  $found = $false
  $livePorts = @()
  foreach ($k in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
    $dp = Get-ItemProperty -LiteralPath (Join-Path $k.PSPath '#\\Device Parameters') -ErrorAction SilentlyContinue
    if (-not $dp -or $dp.'Base Name' -ne 'USB') { continue }
    $inst = (($k.PSChildName -replace '^##\\?#', '') -replace '#\\{[^}]+\\}$', '') -replace '#', '\\'
    $d = Get-PnpDevice -InstanceId $inst -ErrorAction SilentlyContinue
    if ($d -and $d.Present) {
      $livePorts += ('USB{0:000}' -f [int]$dp.'Port Number')
      if ([int]$dp.'Port Number' -eq $num) { $found = $true }
    }
  }
  # Topilmasa — printer hozir qaysi portda ekanini ham aytamiz (boshqa USB uyaga ulangan bo'lishi mumkin)
  if (-not $found) { 'NODEVICE:' + $pr.PortName + ':' + ($livePorts -join ','); exit }
}
if (-not (Test-Path $env:ONEC_DLL)) {
  Add-Type -TypeDefinition $env:ONEC_CS -OutputAssembly $env:ONEC_DLL -OutputType Library
}
Add-Type -Path $env:ONEC_DLL
$res = [OneCRawPrinter]::Send($env:ONEC_PRINTER, $env:ONEC_FILE)
if (-not $res.StartsWith('OK:')) { $res; exit }
$id = [int]$res.Substring(3)
# Windows navbati chekni qabul qildi — endi printer haqiqatan olganini kuzatamiz (≈4 soniya)
for ($i = 0; $i -lt 16; $i++) {
  Start-Sleep -Milliseconds 250
  $job = Get-PrintJob -PrinterName $env:ONEC_PRINTER -ID $id -ErrorAction SilentlyContinue
  if (-not $job) { 'OK'; exit }
  $st = [string]$job.JobStatus
  if ($st -match 'Error|Offline|PaperOut|UserIntervention|Blocked') {
    Remove-PrintJob -PrinterName $env:ONEC_PRINTER -ID $id -ErrorAction SilentlyContinue
    "FAIL:" + $st; exit
  }
}
# Hali navbatda: navbatni xatoli eski chek to'sib turgan bo'lsa — bizniki ham chiqmaydi
$blocked = Get-PrintJob -PrinterName $env:ONEC_PRINTER -ErrorAction SilentlyContinue | Where-Object { [string]$_.JobStatus -match 'Error|Offline|PaperOut|UserIntervention|Blocked' }
if ($blocked) {
  Remove-PrintJob -PrinterName $env:ONEC_PRINTER -ID $id -ErrorAction SilentlyContinue
  'BLOCKED:' + @($blocked).Count; exit
}
# Oldingi cheklar chiqmoqda — navbatda, yuborilgan deb hisoblaymiz
'QUEUED'
`;

let dllDir = os.tmpdir();

/** DLL qayerda saqlanishi (Electron: app.getPath('userData')) */
function setHelperDir(dir) {
  dllDir = dir;
}

function dllPath() {
  // Manba o'zgarsa yangi DLL kompilyatsiya qilinadi
  const hash = crypto.createHash('md5').update(CS_SOURCE).digest('hex').slice(0, 8);
  return path.join(dllDir, `onec-raw-${hash}.dll`);
}

const ERRORS = {
  'OPEN:1801': 'Printer topilmadi — Windows\'dagi printer nomini tekshiring',
  'OPEN:5': 'Printerga kirish rad etildi (ruxsat yo\'q)',
  'DOC:1804': "Printer drayveri RAW rejimni qo'llamaydi",
};

function sendWindows({ printerName }, data) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('USB (Windows drayveri) faqat Windows\'da ishlaydi'));
    if (!printerName) return reject(new Error('Windows printeri tanlanmagan'));

    const file = path.join(os.tmpdir(), `onec-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.bin`);
    fs.writeFileSync(file, data);

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
      {
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, ONEC_DLL: dllPath(), ONEC_CS: CS_SOURCE, ONEC_PRINTER: printerName, ONEC_FILE: file },
      },
      (err, stdout, stderr) => {
        fs.promises.unlink(file).catch(() => {});
        const out = String(stdout || '').trim().split(/\r?\n/).pop();
        if (out === 'OK' || out === 'QUEUED') return resolve();
        if (out && out.startsWith('NODEVICE:')) {
          const [, port, live = ''] = out.split(':');
          const ports = live.split(',').filter(Boolean);
          if (ports.length) {
            return reject(
              new Error(
                `"${printerName}" ${port} portiga sozlangan, lekin printer hozir ${ports.join(' / ')} portida (boshqa USB uyaga ulangan). ` +
                  `Windows'da: Устройства и принтеры → ${printerName} → Свойства принтера → Порты → ${ports[0]} ni belgilang`
              )
            );
          }
          return reject(new Error(`Printer kompyuterga ulanmagan (${port} portida qurilma yo'q) — printerni yoqing va USB kabelni tekshiring`));
        }
        if (out && out.startsWith('BLOCKED:')) {
          return reject(
            new Error(`Printer navbati to'xtab qolgan (${out.slice(8)} ta xatoli chek) — Windows'da printer navbatini oching va eski cheklarni o'chiring`)
          );
        }
        if (out && out.startsWith('FAIL:')) {
          return reject(new Error(`Printer chekni olmadi (${out.slice(5).trim()}) — printer yoqilganini, USB kabel ulanganini va qog'oz borligini tekshiring. Chek navbatdan olib tashlandi`));
        }
        if (out && ERRORS[out]) return reject(new Error(ERRORS[out]));
        if (out && /^(OPEN|DOC|WRITE):/.test(out)) return reject(new Error(`Windows printer xatosi (${out})`));
        reject(new Error((stderr || err?.message || 'Noma\'lum xato').toString().trim().split('\n')[0]));
      }
    );
  });
}

module.exports = { sendWindows, setHelperDir };
