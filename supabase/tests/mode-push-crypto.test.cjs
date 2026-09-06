// Offline RFC 8291 decryption + ES256 signature verification of real web-push output.
// npm install --prefix /tmp/journal-web-push --ignore-scripts web-push@3.6.7
// WEB_PUSH_MODULE=/tmp/journal-web-push/node_modules/web-push node --test this-file
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const webpush = require(process.env.WEB_PUSH_MODULE || 'web-push');
const hkdf = (ikm,salt,info,len) => Buffer.from(crypto.hkdfSync('sha256',ikm,salt,info,len));
test('real pinned library creates encrypted TTL0 request, independently decryptable and VAPID signed',()=>{
  const receiver=crypto.createECDH('prime256v1');receiver.generateKeys();
  const auth=crypto.randomBytes(16),vapid=webpush.generateVAPIDKeys();
  const endpoint='https://fcm.googleapis.com/fcm/send/test-only-never-sent';
  const payload=JSON.stringify({version:'14.4',body:'Une nouveauté sur votre chantier.'});
  const details=webpush.generateRequestDetails({endpoint,keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}},payload,{
    TTL:0,contentEncoding:'aes128gcm',urgency:'high',topic:'0'.repeat(32),timeout:8000,
    vapidDetails:{subject:'https://example.test/app/',...{publicKey:vapid.publicKey,privateKey:vapid.privateKey}}
  });
  assert.equal(details.endpoint,endpoint);assert.equal(details.method,'POST');assert.equal(Number(details.headers.TTL),0);
  assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.equal(details.body.includes(Buffer.from(payload)),false);
  const body=details.body,salt=body.subarray(0,16),recordSize=body.readUInt32BE(16),keyLength=body[20],sender=body.subarray(21,21+keyLength);
  assert.equal(keyLength,65);assert.ok(recordSize>=payload.length+17);
  const shared=receiver.computeSecret(sender);
  const keyInfo=Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),sender]);
  const ikm=hkdf(shared,auth,keyInfo,32),cek=hkdf(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdf(ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
  const encrypted=body.subarray(21+keyLength),decipher=crypto.createDecipheriv('aes-128-gcm',cek,nonce);decipher.setAuthTag(encrypted.subarray(-16));
  const plain=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);assert.equal(plain.at(-1),2);assert.equal(plain.subarray(0,-1).toString(),payload);
  const authorization=details.headers.Authorization;
  const token=/t=([^,]+)/.exec(authorization)[1],pieces=token.split('.');
  const claims=JSON.parse(Buffer.from(pieces[1],'base64url'));assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.sub,'https://example.test/app/');assert.ok(claims.exp>Date.now()/1000);
  const pub=Buffer.from(vapid.publicKey,'base64url');
  const publicKey=crypto.createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')}});
  assert.equal(crypto.verify('sha256',Buffer.from(pieces.slice(0,2).join('.')),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(pieces[2],'base64url')),true);
});
