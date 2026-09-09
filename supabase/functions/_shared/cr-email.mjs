const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The preview and the provider use this exact same renderer and stored text.
export function emailMarkup(body){
 const headings=['PRODUCTION RÉALISÉE','SÉCURITÉ','CONSIGNATIONS CATÉNAIRES','ITC — ZEP PRISES','ARF'];
 const lines=String(body||'').split('\n');let html='',rows=[];
 const flush=()=>{if(!rows.length)return;html+='<table role="table" style="border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed"><thead><tr>'+['Référence','Prévu','Réel','Commentaire'].map((x,i)=>'<th style="text-align:left;padding:9px 6px;background:#f2f4f6;width:'+(i===0?28:24)+'%">'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';rows=[];};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(line==='CR OFF — DIFFUSION RESTREINTE')continue;
  if(line.startsWith(' • ')&&lines[i+1]?.startsWith('   Prévu : ')&&lines[i+2]?.startsWith('   Réel : ')){
   const cells=[line.slice(3),lines[++i].slice('   Prévu : '.length),lines[++i].slice('   Réel : '.length),''];if(lines[i+1]?.startsWith('   Commentaire : '))cells[3]=lines[++i].slice('   Commentaire : '.length);
   rows.push('<tr>'+cells.map(x=>'<td style="padding:10px 6px;border-bottom:1px solid #e3e6e9;vertical-align:top;overflow-wrap:anywhere">'+esc(x||'—')+'</td>').join('')+'</tr>');continue;
  }
  if(!line){flush();continue;}flush();
  if(headings.includes(line))html+='<h2 style="font-size:15px;letter-spacing:.3px;margin:25px 0 10px;padding-bottom:8px;border-bottom:2px solid #ad1738;color:#96152f">'+esc(line)+'</h2>';
  else if(line.includes(' · nuit du '))html+='<h1 style="font-size:21px;line-height:1.4;margin:10px 0 20px;color:#28343d">'+esc(line)+'</h1>';
  else html+='<p style="margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere">'+esc(line)+'</p>';
 }
 flush();return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>CR off · Journal de chantier</title></head><body style="margin:0;background:#f2f4f6;font:14px/1.55 Arial,sans-serif;color:#29343d"><main style="max-width:780px;margin:auto;background:white"><header style="padding:22px;background:#a91334;color:white"><b style="font-size:22px">Compte rendu de nuit</b><br><span style="font-size:12px;letter-spacing:1px">JOURNAL DE CHANTIER · DIFFUSION RESTREINTE</span></header><div style="padding:18px">'+html+'</div><footer style="padding:16px 18px;background:#f6f7f8;color:#6b7178;font-size:12px">Compte rendu interne · Copie de la version validée dans le Journal de chantier.</footer></main></body></html>';
}
