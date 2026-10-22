Option Explicit
Dim shell, fso, base, nodeExe, serverFile, logFile, command, chrome, q
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = base & "\runtime\node.exe"
serverFile = base & "\server.cjs"
logFile = base & "\data\server.log"
q = Chr(34)

If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"
If Not fso.FolderExists(base & "\data") Then fso.CreateFolder(base & "\data")

shell.Environment("PROCESS")("NO_OPEN") = "1"
command = "cmd.exe /c cd /d " & q & base & q & " && " & q & nodeExe & q & " " & q & serverFile & q & " >> " & q & logFile & q & " 2>&1"
shell.Run command, 0, False
WScript.Sleep 1800

chrome = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome SxS\Application\chrome.exe"
If fso.FileExists(chrome) Then
  shell.Run q & chrome & q & " " & q & "http://127.0.0.1:8170/" & q, 1, False
Else
  shell.Run "http://127.0.0.1:8170/", 1, False
End If