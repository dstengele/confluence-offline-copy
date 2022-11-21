$taskPath = "\BackupConfluence\"
$name = 'BackupConfluence'
$runAt = '2:00 AM'
$exe = 'C:\Program Files\nodejs\node.exe'
$params = 'dump.js'
$location = "C:\Users\Example\confluence-offline-copy"
$username = "user"
$password = "secret"

Unregister-ScheduledTask -TaskName $name -TaskPath $taskPath -Confirm:$false -ErrorAction:SilentlyContinue  

$action = New-ScheduledTaskAction -Execute "$exe" -Argument "$params" -WorkingDirectory $location
$trigger = New-ScheduledTaskTrigger -Daily -At $runAt
Register-ScheduledTask -TaskName $name -TaskPath $taskPath -Action $action -Trigger $trigger  -User "$username" -Password "$password" | Out-Null