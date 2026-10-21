' UfcTipp: az ütemezett szinkron ablak nélkül (a Feladatütemező ezt hívja 5 percenként).
' Kézi, látható futtatás: sync.cmd
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\.."
sh.Run """C:\xampp\php\php.exe"" tools\sync.php auto", 0, True
