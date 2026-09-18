const {app,safeStorage}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
class Settings {
  constructor(){this.data={startAtLogin:false,verified:false,pairing:null};}
  async load(){try{this.data=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'carekoala-settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('Settings could not be read.');}}
  async save(){const p=path.join(app.getPath('userData'),'carekoala-settings.json');await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p+'.tmp',JSON.stringify(this.data));await fs.rename(p+'.tmp',p);}
  pair(){if(!this.data.pairing)return null;if(!safeStorage.isEncryptionAvailable())throw new Error('Windows key protection is unavailable.');return JSON.parse(safeStorage.decryptString(Buffer.from(this.data.pairing,'base64')));}
  fingerprint(pair){return crypto.createHash('sha256').update(Buffer.from(pair.key,'base64')).update(Buffer.from(pair.route,'base64')).digest('hex').slice(0,24).match(/.{4}/g).join('-');}
  async createPair(){
    if(!safeStorage.isEncryptionAvailable())throw new Error('Windows key protection is unavailable.');
    const p={v:1,key:crypto.randomBytes(32).toString('base64'),route:crypto.randomBytes(32).toString('base64')};
    this.data.pairing=safeStorage.encryptString(JSON.stringify(p)).toString('base64');this.data.verified=false;await this.save();
    return {code:'CK1.'+Buffer.from(JSON.stringify(p)).toString('base64url'),fingerprint:this.fingerprint(p)};
  }
  public(){const p=this.pair();return {startAtLogin:!!this.data.startAtLogin,paired:!!p && this.data.verified,fingerprint:p?this.fingerprint(p):null};}
  async verify(fingerprint){const p=this.pair();if(!p || fingerprint!==this.fingerprint(p))throw new Error('Fingerprints do not match.');this.data.verified=true;await this.save();return this.public();}
  async forget(){this.data.pairing=null;this.data.verified=false;await this.save();return this.public();}
}
module.exports={Settings};
