const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function emailMarkup(body){
 if(!body.startsWith('CR OFF — DIFFUSION RESTREINTE'))return undefined;
 const headings=['PRODUCTION RÉALISÉE','SÉCURITÉ','CONSIGNATIONS CATÉNAIRES','ITC — ZEP PRISES','ARF'];
 const lines=body.split('\n');let html='',rows=[];
 const flush=()=>{if(!rows.length)return;html+='<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>'+['Référence','Prévu','Réel','Commentaire'].map(x=>'<th style="text-align:left;padding:8px;background:#f2f4f7">'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';rows=[];};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(line.startsWith(' • ')&&lines[i+1]?.startsWith('   Prévu : ')&&lines[i+2]?.startsWith('   Réel : ')){
   const cells=[line.slice(3),lines[++i].slice(11),lines[++i].slice(10),''];if(lines[i+1]?.startsWith('   Commentaire : '))cells[3]=lines[++i].slice(17);
   rows.push('<tr>'+cells.map(x=>'<td style="padding:8px;border-bottom:1px solid #ddd;vertical-align:top">'+esc(x)+'</td>').join('')+'</tr>');continue;
  }
  if(!line){flush();continue;}flush();
  if(headings.includes(line))html+='<h2 style="font-size:15px;margin:22px 0 9px;color:#9d1830">'+esc(line)+'</h2>';
  else html+='<p style="margin:5px 0;white-space:pre-wrap">'+esc(line)+'</p>';
 }
 flush();return '<!doctype html><html lang="fr"><body style="font:14px/1.6 Arial,sans-serif;color:#26313d"><main style="max-width:800px;margin:auto;padding:18px">'+html+'</main></body></html>';
}
