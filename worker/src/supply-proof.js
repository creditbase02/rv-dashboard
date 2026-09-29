// Stable JSON is shared by Worker signing and offline CI verification.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const bytes = text => new TextEncoder().encode(text);
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function identity(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(String(value).trim().toUpperCase())))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const decode = value => Uint8Array.from(atob(value), c=>c.charCodeAt(0));
export async function signSnapshot(snapshot, config, parent, privateJwk) {
  const data=structuredClone(snapshot);
  data.lock={version:config.version,through:config.through,parent};
  const key=await crypto.subtle.importKey('jwk',privateJwk,'Ed25519',false,['sign']);
  const signature=await crypto.subtle.sign('Ed25519',key,bytes(canonical(data)));
  data.lock.signature=btoa(String.fromCharCode(...new Uint8Array(signature)));
  return data;
}
export async function verifySnapshot(data,config) {
  if (!data?.lock || data.lock.version!==config.version || data.lock.through!==config.through ||
      data.date<config.through || Object.keys(data.lock).sort().join()!=='parent,signature,through,version' ||
      !/^[a-f0-9]{64}$/.test(data.lock.parent)) throw Error('Supply 鎖定基準版本不符');
  const copy=structuredClone(data),signature=copy.lock.signature;delete copy.lock.signature;
  const key=await crypto.subtle.importKey('jwk',config.public_key,'Ed25519',false,['verify']);
  if (!await crypto.subtle.verify('Ed25519',key,decode(signature),bytes(canonical(copy)))) throw Error('Supply 鎖定簽章驗證失敗');
  return true;
}
export async function verifyTransition(current,previous,config){
  await verifySnapshot(current,config);await verifySnapshot(previous,config);
  if(canonical(current)!==canonical(previous)&&current.lock.parent!==await digest(previous))throw Error('Supply 更新基於過期版本，請重新核對');
}
