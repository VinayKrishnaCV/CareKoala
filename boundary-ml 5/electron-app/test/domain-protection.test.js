const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
test('hosts installer preserves custom entries, updates idempotently, retains list on failure and disables cleanly',{skip:process.platform!=='win32'},()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ck-hosts-test-'));
 const hosts=path.join(folder,'System32/drivers/etc/hosts');fs.mkdirSync(path.dirname(hosts),{recursive:true});
 const original='127.0.0.1 localhost\r\n192.0.2.10 intranet.example\r\n';fs.writeFileSync(hosts,original);
 const literal="'"+folder.replaceAll("'","''")+"'";
 let source=fs.readFileSync(path.join(__dirname,'../windows/DomainProtection.ps1'),'utf8').replaceAll('$env:ProgramFiles',literal).replaceAll('$env:SystemRoot',literal).replace('Global\\CareKoalaDomainProtection','Local\\CareKoalaDomainProtectionTest');
 const mocks=`
function Invoke-WebRequest { param($UseBasicParsing,$Uri,$TimeoutSec,$MaximumRedirection)
 if(Test-Path '${folder.replaceAll("'","''")}/fail'){throw 'offline'}
 $rows=1..1001 | ForEach-Object {"0.0.0.0 blocked$_.example"}
 return @{Content=($rows -join "\n")+"\n0.0.0.0 ntfy.sh\n0.0.0.0 raw.githubusercontent.com\n0.0.0.0 invalid..domain\n"}
}
function New-ScheduledTaskAction {param($Execute,$Argument) return @{dummy=1}}
function New-ScheduledTaskTrigger {param([switch]$Daily,$At) return @{dummy=1}}
function New-ScheduledTaskSettingsSet {param([switch]$StartWhenAvailable,$ExecutionTimeLimit) return @{dummy=1}}
function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Settings,$User,$RunLevel,[switch]$Force)}
function Get-ScheduledTask {param($TaskName,$ErrorAction) return @{State='Ready'}}
function Unregister-ScheduledTask {param($TaskName,$Confirm,$ErrorAction)}
function ipconfig.exe {param($option)}
`;
 // The real installer body runs against a fixture; no hosts, task or network
 // operation can reach the operating system in this test.
 source=source.replace("$ErrorActionPreference='Stop'",mocks+"\n$ErrorActionPreference='Stop'").replace('param($UseBasicParsing,$Uri','param([switch]$UseBasicParsing,$Uri');
 const helper=path.join(folder,'fixture.ps1');fs.writeFileSync(helper,source);
 const run=mode=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode',mode],{encoding:'utf8',windowsHide:true});
 try{
  let result=run('Enable');assert.equal(result.status,0,result.stderr);
  let text=fs.readFileSync(hosts,'utf8');assert.ok(text.startsWith(original));
  const entries=text.split(/\r?\n/).filter(line=>line.startsWith('0.0.0.0 '));
  assert.equal(entries.length,112);assert.equal(entries.reduce((n,line)=>n+line.split(' ').length-1,0),1001);
  assert.ok(!text.includes(' ntfy.sh'));assert.ok(!text.includes('invalid..domain'));
  result=run('Update');assert.equal(result.status,0,result.stderr);text=fs.readFileSync(hosts,'utf8');assert.equal(text.split('# BEGIN CAREKOALA').length,2);
  fs.writeFileSync(path.join(folder,'fail'),'1');assert.equal(run('Update').status,1);assert.equal(fs.readFileSync(hosts,'utf8'),text);
  result=run('Disable');assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(hosts,'utf8'),original);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
