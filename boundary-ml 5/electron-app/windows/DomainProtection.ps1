param([ValidateSet('Enable','Update','Disable')][string]$Mode='Update')
$ErrorActionPreference='Stop'
$taskName='CareKoala Domain Protection Update'
$installDir=Join-Path $env:ProgramFiles 'CareKoalaDomainProtection'
$installedScript=Join-Path $installDir 'DomainProtection.ps1'
$hostsPath=Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$begin='# BEGIN CAREKOALA DOMAIN PROTECTION'
$end='# END CAREKOALA DOMAIN PROTECTION'
$mutex=New-Object System.Threading.Mutex($false,'Global\CareKoalaDomainProtection')
$held=$false
try {
  $held=$mutex.WaitOne(30000)
  if(!$held){throw 'Another update is running'}
  $old=[IO.File]::ReadAllText($hostsPath)
  $pattern='(?ms)^# BEGIN CAREKOALA DOMAIN PROTECTION\r?\n.*?^# END CAREKOALA DOMAIN PROTECTION(?:\r?\n|$)'
  if(($old.Contains($begin) -or $old.Contains($end)) -and ![regex]::IsMatch($old,$pattern)){throw 'Incomplete CareKoala block; inspect hosts before changing it'}
  $clean=[regex]::Replace($old,$pattern,'')
  if($Mode -eq 'Disable'){
    if([IO.File]::ReadAllText($hostsPath) -ne $old){throw 'Hosts changed during this operation; retry'}
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if($old -ne $clean){[IO.File]::WriteAllText($hostsPath,$clean,(New-Object Text.UTF8Encoding($false)))}
    & ipconfig.exe /flushdns | Out-Null
    exit 0
  }
  # Automatic updates never enable protection that the user has disabled.
  if($Mode -eq 'Update' -and !$old.Contains($begin)){throw 'Enable domain protection first'}
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  $response=Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts' -TimeoutSec 45 -MaximumRedirection 0
  $body=[string]$response.Content
  if($body.Length -gt 20MB){throw 'Oversized list'}
  $domains=New-Object 'System.Collections.Generic.HashSet[string]'
  foreach($line in ($body -split '\r?\n')){
    if($line -match '^0\.0\.0\.0\s+([a-zA-Z0-9.-]+)(?:\s|$)'){
      $domain=$Matches[1].ToLowerInvariant()
      if($domain.Length -gt 253 -or $domain -notmatch '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'){continue}
      # Never block the notification relay or the list-update endpoint.
      if($domain -eq 'ntfy.sh' -or $domain.EndsWith('.ntfy.sh') -or $domain -eq 'raw.githubusercontent.com'){continue}
      [void]$domains.Add($domain)
    }
  }
  if($domains.Count -lt 1000 -or $domains.Count -gt 300000){throw 'Unexpected list size; previous list retained'}
  if(Test-Path -LiteralPath $installDir){if((Get-Item -LiteralPath $installDir).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Invalid install directory'}}
  [void][IO.Directory]::CreateDirectory($installDir)
  if((Test-Path -LiteralPath $installedScript) -and ((Get-Item -LiteralPath $installedScript).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid updater file'}
  if([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($installedScript)){Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript -Force}
  $backup=Join-Path $installDir 'hosts.before-carekoala'
  if(!(Test-Path -LiteralPath $backup)){[IO.File]::WriteAllText($backup,$old,(New-Object Text.UTF8Encoding($false)))}
  # Windows DNS Client has severe performance issues with long hosts files.
  # Use standard hosts aliases (up to nine per line) without dropping domains.
  $sorted=@($domains | Sort-Object)
  $lines=New-Object 'System.Collections.Generic.List[string]'
  for($i=0;$i -lt $sorted.Length;$i+=9){
    $last=[Math]::Min($i+8,$sorted.Length-1)
    $lines.Add('0.0.0.0 '+($sorted[$i..$last] -join ' '))
  }
  $entries=$lines -join "`r`n"
  $updated=$clean.TrimEnd("`r","`n")+"`r`n"+$begin+"`r`n# Source: https://github.com/StevenBlack/hosts; updated $([DateTime]::UtcNow.ToString('o'))`r`n"+$entries+"`r`n"+$end+"`r`n"
  $exe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $action=New-ScheduledTaskAction -Execute $exe -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedScript`" -Mode Update"
  $trigger=New-ScheduledTaskTrigger -Daily -At '12:00'
  $options=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
  if([IO.File]::ReadAllText($hostsPath) -ne $old){throw 'Hosts changed during download; retry to preserve external changes'}
  if($Mode -eq 'Enable'){Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $options -User 'SYSTEM' -RunLevel Highest -Force | Out-Null}
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if($task.State -eq 'Disabled'){throw 'Daily blocklist updater is disabled'}
  [IO.File]::WriteAllText($hostsPath,$updated,(New-Object Text.UTF8Encoding($false)))
  & ipconfig.exe /flushdns | Out-Null
  $status=@{count=$domains.Count;updated=[DateTime]::UtcNow.ToString('o');scheduled=$true;format='compressed-hosts-v1'} | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $installDir 'status.json'),$status,(New-Object Text.UTF8Encoding($false)))
  exit 0
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 1
} finally {if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}
