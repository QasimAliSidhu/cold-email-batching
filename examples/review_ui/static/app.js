'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csrf = $('meta[name="review-token"]').content;
let state, page = 'recipients', recipientId, search = '', busy = false, dirty = false;
let checks = {recipients:false, emails:false, resume:false}, noticeTimer;
function notify(message, error = false) {
  const box = $('#notice'); box.textContent = message; box.hidden = false; box.className = error ? 'error' : '';
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => box.hidden = true, error ? 20000 : 8000);
}
async function api(path, method = 'GET', data) {
  const options = {method, headers:{'X-Review-Token':csrf}};
  if (data instanceof FormData) options.body = data;
  else if (data !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
  const response = await fetch(path, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}
function accept(next) {
  if (state && state.revision !== next.revision) checks = {recipients:false, emails:false, resume:false};
  state = next;
  if (!state.rows.some(r => r.id === recipientId)) recipientId = state.rows.find(r => r.selected)?.id || state.rows[0]?.id;
  overview();
}
async function action(path, method, data, message) {
  if (busy) return;
  busy = true; document.body.classList.add('busy');
  try { accept(await api(path, method, data)); dirty = false; render(); if (message) notify(message); }
  catch (error) { notify(error.message, true); }
  finally { busy = false; document.body.classList.remove('busy'); }
}
function overview() {
  $('#loading').hidden = true; $('#overview').hidden = false;
  const status = state.active ? 'Sending' : state.reviewed ? 'Reviewed' : 'Awaiting review';
  $('#overview').innerHTML = `<div class="stat"><small>SELECTED RECIPIENTS</small><strong>${state.selected_count}<span class="muted"> / ${state.total}</span></strong></div><div class="stat"><small>RESUME DELIVERY</small><strong class="small-number">${state.config.resume_mode === 'attachment' ? 'PDF attachment' : 'Public resume link'}</strong></div><div class="stat"><small>MESSAGE SPACING</small><strong>${Math.round(state.config.seconds_between_emails / 60 * 10) / 10}<span class="muted"> min</span></strong></div><div class="stat"><small>CAMPAIGN STATUS</small><strong class="small-number">${status}</strong></div>`;
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
}
function sourceLinks(sources) {
  return (Array.isArray(sources) ? sources : []).filter(u => /^https?:\/\//i.test(u)).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Source ${i + 1} ↗</a>`).join(' · ');
}
function rowStatus(r) { return r.delivery_status === 'draft' ? (r.contact_kind === 'recruiting' ? 'Recruiting contact' : 'Routing inquiry') : r.delivery_status.replaceAll('_', ' '); }
function render() {
  overview();
  const content = $('#content');
  if (page === 'recipients') renderRecipients(content);
  else if (page === 'emails') renderEmails(content);
  else if (page === 'resume') renderResume(content);
  else if (page === 'account') renderAccount(content);
  else if (page === 'history') renderHistory(content);
  else renderReview(content);
}
function renderRecipients(content) {
  content.innerHTML = `<section class="card"><div class="section-heading"><div><h2>Review your recipients</h2><p class="muted">Public contacts from your company database. Review the company, greeting, and source before selecting.</p></div><div class="actions"><a href="/api/recipients.csv" class="delivery-link">Download CSV ↓</a><button id="import-csv" ${state.active?'disabled':''}>Import CSV</button></div></div><div class="toolbar"><input id="search" type="search" placeholder="Search company, name, or email" aria-label="Search recipients" value="${esc(search)}"><div class="actions"><span class="muted">${state.selected_count} selected</span><button id="select-all" ${state.active?'disabled':''}>Select all</button><button id="select-none" ${state.active?'disabled':''}>Clear selection</button></div></div><div class="table-wrap"><table><thead><tr><th>Use</th><th>Company / contact</th><th>Email address</th><th>Contact purpose</th><th>Evidence</th><th></th></tr></thead><tbody id="recipient-rows"></tbody></table></div><p class="muted">${state.skipped.length} fictional rows were excluded during validation. Team greetings are used where an individual name was not published.</p><details><summary>Show excluded companies</summary><div id="excluded"></div></details><div class="actions"><button class="primary" id="next-emails">Continue to email drafts →</button></div></section>`;
  drawRows();
  $('#excluded').textContent = state.skipped.map(r => `${r.company || r.name || 'Company'} — ${r.reason || r.skip_reason || 'No suitable public contact'}`).join('\n'); $('#excluded').style.whiteSpace = 'pre-line';
  $('#search').oninput = event => { search = event.target.value; drawRows(); };
  $('#select-all').onclick = () => action('/api/select','POST',{selected:true});
  $('#select-none').onclick = () => action('/api/select','POST',{selected:false});
  $('#import-csv').onclick = () => $('#csv-upload').click();
  $('#next-emails').onclick = () => navigate('emails');
}
function drawRows() {
  const query = search.toLowerCase();
  const rows = state.rows.filter(r => `${r.company} ${r.name} ${r.email}`.toLowerCase().includes(query));
  $('#recipient-rows').innerHTML = rows.map(r => `<tr><td><input type="checkbox" data-selected="${r.id}" aria-label="Select ${esc(r.company)}" ${r.selected?'checked':''} ${state.active?'disabled':''}></td><td class="company">${esc(r.company)}<small>${esc(r.name)}</small></td><td>${esc(r.email)}</td><td><span class="badge ${r.contact_kind==='recruiting'?'':'gray'}">${esc(rowStatus(r))}</span></td><td>${sourceLinks(r.email_sources) || '<span class="muted">CSV supplied</span>'}</td><td><button class="text-button" data-edit="${r.id}" ${state.active?'disabled':''}>Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No recipients match your search.</td></tr>';
  $$('[data-selected]').forEach(input => input.onchange = () => action(`/api/recipients/${input.dataset.selected}`,'PATCH',{selected:input.checked}));
  $$('[data-edit]').forEach(button => button.onclick = () => editRecipient(button.dataset.edit));
}
function editRecipient(id) {
  const row = state.rows.find(r => r.id === id); const form = $('#recipient-form');
  ['id','name','company','email','note'].forEach(key => form.elements[key].value = row[key]);
  $('#editor').showModal();
}
function renderEmails(content) {
  const selected = state.rows.filter(r => r.selected);
  let row = selected.find(r => r.id === recipientId) || selected[0];
  if (!row) { content.innerHTML = '<div class="card empty">Select recipients first to preview the final emails.</div>'; return; }
  recipientId = row.id;
  content.innerHTML = `<div class="section-heading"><div><h2>Make every message relevant</h2><p class="muted">Sample drafts generated by the real Python template functions. Sending is disabled.</p></div><a href="/api/email-previews.txt">Download all final emails ↓</a></div><div class="split"><aside class="card"><h3>${selected.length} selected recipients</h3><div class="recipient-list">${selected.map(r=>`<button class="recipient-choice ${r.id===row.id?'active':''}" data-draft="${r.id}">${esc(r.company)}<small>${esc(r.email)}</small></button>`).join('')}</div></aside><section class="card"><div class="section-heading"><h3>${esc(row.company)}</h3><span class="badge">${row.subject_override || row.body_override?'Custom draft':'Personalized template'}</span></div><div class="envelope">From: <strong>${esc(row.preview.from_name)} &lt;${esc(row.preview.from)}&gt;</strong><br>To: <strong>${esc(row.name)} &lt;${esc(row.email)}&gt;</strong><br>Resume: <strong>${state.config.resume_mode==='attachment'?esc(state.resume.name):esc(state.config.resume_url || 'Choose a public link')}</strong></div><form id="draft-form"><label>Subject<input id="draft-subject" required value="${esc(row.preview.subject)}" ${state.active?'disabled':''}></label><label>Final message<textarea id="draft-body" required rows="15" ${state.active?'disabled':''}>${esc(row.preview.body)}</textarea></label><div class="actions"><button type="submit" class="primary" ${state.active?'disabled':''}>Save this email</button><button type="button" id="reset-draft" ${state.active?'disabled':''}>Use template</button><a href="/api/email/${row.id}.eml">Download .eml</a></div></form><p class="muted">Personalization evidence: ${sourceLinks(row.note_sources) || 'Review the note in your CSV.'}</p></section></div><section class="card"><details><summary>Edit the template for all recipients</summary><p class="muted">Available fields: <code>{name}</code> <code>{company}</code> <code>{note}</code> <code>{question}</code> <code>{resume_line}</code> <code>{email}</code>. Saved custom drafts remain in place.</p><form id="template-form"><label>Default subject<input id="template-subject" value="${esc(state.config.subject_template)}" required ${state.active?'disabled':''}></label><label>Default message<textarea id="template-body" rows="12" required ${state.active?'disabled':''}>${esc(state.config.body_template)}</textarea></label><button class="primary" ${state.active?'disabled':''}>Save template</button></form></details><div class="actions"><button id="next-resume">Continue to resume →</button></div></section>`;
  $$('[data-draft]').forEach(b => b.onclick = () => { if (!discardChanges()) return; recipientId=b.dataset.draft; render(); });
  $('#draft-form').oninput = () => dirty = true;
  $('#template-form').oninput = () => dirty = true;
  $('#draft-form').onsubmit = e => { e.preventDefault(); action(`/api/recipients/${row.id}`,'PATCH',{subject_override:$('#draft-subject').value,body_override:$('#draft-body').value},'Final email saved.'); };
  $('#reset-draft').onclick = () => action(`/api/recipients/${row.id}`,'PATCH',{subject_override:'',body_override:''},'Template restored for this recipient.');
  $('#template-form').onsubmit = e => { e.preventDefault(); action('/api/config','PATCH',{subject_template:$('#template-subject').value,body_template:$('#template-body').value},'Template saved. Review the updated emails.'); };
  $('#next-resume').onclick = () => navigate('resume');
}
function renderResume(content) {
  content.innerHTML = `<section class="card"><div class="section-heading"><div><h2>Check the resume they will receive</h2><p class="muted">Your updated resume is loaded. Review every page below.</p></div><div class="actions"><a href="/api/resume.pdf" target="_blank" rel="noopener">Open PDF ↗</a><a href="/api/resume.pdf?download=1">Download ↓</a><button id="replace-resume" ${state.active?'disabled':''}>Replace PDF</button></div></div><div class="file-card"><span class="file-icon">PDF</span><div class="resume-info"><strong>${esc(state.resume.name)}</strong><div class="muted">${(state.resume.bytes/1024).toFixed(1)} KB · ${state.resume.exists?'Ready to review':'File missing'}</div></div></div><form id="resume-form"><div class="form-grid"><label class="check"><input type="radio" name="mode" value="attachment" ${state.config.resume_mode==='attachment'?'checked':''} ${state.active?'disabled':''}>Attach the updated PDF</label><label class="check"><input type="radio" name="mode" value="url" ${state.config.resume_mode==='url'?'checked':''} ${state.active?'disabled':''}>Use a public resume link</label></div><label>Public HTTPS resume link<input id="resume-url" type="url" value="${esc(state.config.resume_url)}" placeholder="https://…" ${state.active?'disabled':''}></label><p class="muted">For a link, open it in a signed-out browser and confirm it shows this updated resume. The app does not upload or publish your PDF.</p><button class="primary" ${state.active?'disabled':''}>Save delivery option</button></form><div id="pdf-pages" class="pdf-pages"><p class="muted">Loading resume pages…</p></div><button id="next-review" class="primary">Continue to review &amp; send →</button></section>`;
  $('#replace-resume').onclick = () => $('#resume-upload').click();
  $('#resume-form').oninput = () => dirty = true;
  $('#resume-form').onsubmit = e => { e.preventDefault(); action('/api/config','PATCH',{resume_mode:$('input[name="mode"]:checked').value,resume_url:$('#resume-url').value.trim()},'Resume delivery saved. Email previews have been updated.'); };
  $('#next-review').onclick = () => navigate('review');
  api('/api/resume-info').then(info => { if (page !== 'resume') return; $('#pdf-pages').innerHTML=Array.from({length:info.pages},(_,i)=>`<figure><img src="/api/resume-page/${i}.png?v=${state.resume.sha256}" alt="Resume page ${i+1}" loading="lazy"><figcaption>Page ${i+1} of ${info.pages}</figcaption></figure>`).join(''); }).catch(e => { if (page==='resume') $('#pdf-pages').textContent=e.message; });
}
function connectionDescription() {
  if (state.credentials.connected) return 'Connected · Google SMTP sign-in verified';
  if (state.credentials.authentication==='failed') {
    if (state.credentials.smtp_code===535) return 'Google rejected the sign-in. Check this account’s app password.';
    return `Connection test did not complete (${state.credentials.phase || 'connection'}). Check network access and retry.`;
  }
  return state.credentials.configured ? 'App password saved · connection test required' : 'Add a Google app password to connect';
}
function renderAccount(content) {
  content.innerHTML = `<section class="card"><div class="section-heading"><div><h2>Sender account</h2><p class="muted">Use this account for the reviewed campaign.</p></div><span class="badge ${state.credentials.connected?'':'orange'}">${state.credentials.connected?'Connected':'Not connected'}</span></div><label>Email address<input value="demo@sender.example" readonly></label><p id="connection-status" class="hint ${state.credentials.connected?'':'warning'}">${esc(connectionDescription())}</p><form id="password-form"><label>Google app password<input id="app-password" type="password" autocomplete="new-password" placeholder="16-letter app password" minlength="16" maxlength="24" ${state.active?'disabled':''}></label><p class="muted">Enter it here, not in chat. It is encrypted for your Windows account and never displayed in previews or exports.</p><div class="actions"><button type="submit" ${state.active?'disabled':''}>Save encrypted password</button><button type="button" id="test-connection" class="primary" ${state.active?'disabled':''}>Test connection</button></div><p class="muted">The connection test signs in only; it does not send an email.</p></form></section><section class="card"><h2>Campaign settings</h2><form id="settings-form"><label>Sender display name<input id="sender-name" value="${esc(state.config.sender_name)}" required ${state.active?'disabled':''}></label><div class="form-grid"><label>Seconds between messages<input id="spacing" type="number" min="30" max="3600" value="${state.config.seconds_between_emails}" required ${state.active?'disabled':''}></label><label>Maximum recipients in this batch<input id="limit" type="number" min="1" max="500" value="${state.config.batch_limit}" required ${state.active?'disabled':''}></label></div><p class="muted">The default is one email every 3 minutes. This spacing does not guarantee inbox delivery.</p><button class="primary" ${state.active?'disabled':''}>Save settings</button></form></section>`;
  $('#settings-form').oninput=()=>dirty=true;
  $('#settings-form').onsubmit=e=>{e.preventDefault();action('/api/config','PATCH',{sender_name:$('#sender-name').value,seconds_between_emails:Number($('#spacing').value),batch_limit:Number($('#limit').value)},'Settings saved.');};
  $('#password-form').onsubmit=e=>{e.preventDefault();const password=$('#app-password').value;$('#app-password').value='';action('/api/credentials','POST',{password},'App password encrypted and saved. Test the connection next.');};
  $('#test-connection').onclick=async()=>{
    if(busy)return;busy=true;const button=$('#test-connection');button.disabled=true;button.textContent='Testing sign-in…';
    try{const result=await api('/api/connection/test','POST',{});accept(result.state);render();notify(state.credentials.connected?'Google SMTP connected. No email was sent.':connectionDescription(),!state.credentials.connected);}catch(e){notify(e.message,true);button.disabled=false;button.textContent='Test connection';}finally{busy=false;}
  };
}
function renderReview(content) {
  content.innerHTML = `<section class="card"><div class="section-heading"><div><h2>One final check before sending</h2><p class="muted">Approval applies to this exact selection, message content, resume, and account.</p></div><span class="badge ${state.reviewed?'':'orange'}">${state.reviewed?'Review approved':'Sending locked'}</span></div><div class="summary-grid"><div><small>FROM</small>${esc(state.config.sender_name)} &lt;demo@sender.example&gt;</div><div><small>RECIPIENTS</small>${state.selected_count} selected companies · one email per contact</div><div><small>RESUME</small>${state.config.resume_mode==='attachment'?esc(state.resume.name):esc(state.config.resume_url || 'Link not set')}</div><div><small>SCHEDULE</small>${state.config.seconds_between_emails} seconds apart · about ${state.estimated_minutes} minutes of spacing</div></div>${state.readiness.length?`<div class="hint warning"><strong>Complete these before approval</strong><ul class="problems">${state.readiness.map(p=>`<li>${esc(p)}</li>`).join('')}</ul><button id="go-account">Open sender &amp; settings</button></div>`:''}<div class="review-checks"><label class="check"><input id="check-recipients" type="checkbox" ${checks.recipients||state.reviewed?'checked':''} ${state.active?'disabled':''}>I checked the CSV, selected recipients, and contact names.</label><label class="check"><input id="check-emails" type="checkbox" ${checks.emails||state.reviewed?'checked':''} ${state.active?'disabled':''}>I checked the final personalized subjects and email bodies.</label><label class="check"><input id="check-resume" type="checkbox" ${checks.resume||state.reviewed?'checked':''} ${state.active?'disabled':''}>I checked the updated resume and its delivery option.</label></div><div class="actions"><button id="approve" ${state.active||state.readiness.length||state.reviewed?'disabled':''}>Approve reviewed campaign</button><button id="start" class="primary" ${!state.reviewed||state.active||state.readiness.length?'disabled':''}>Start sending ${state.selected_count} emails</button>${state.active?'<button id="stop" class="danger">Stop after current email</button>':''}</div><p class="muted">Editing a recipient, draft, resume, password, or setting clears the approval. Already contacted recipients are skipped.</p><div id="live-progress"></div></section>`;
  ['recipients','emails','resume'].forEach(key=>$('#check-'+key).onchange=e=>{checks[key]=e.target.checked;updateApprovalButton();});
  updateApprovalButton();
  if($('#go-account'))$('#go-account').onclick=()=>navigate('account');
  $('#approve').onclick=()=>action('/api/review','POST',{revision:state.revision,checks},'Review saved. Click Start sending when ready.');
  $('#start').onclick=()=>{if(confirm(`Send the reviewed campaign to ${state.selected_count} selected contacts from demo@sender.example?\n\nResume: ${state.config.resume_mode==='attachment'?state.resume.name:state.config.resume_url}\nMessages will be spaced ${state.config.seconds_between_emails} seconds apart.`))action('/api/send/start','POST',{revision:state.revision},'Sending started. You can stop after the current message.');};
  if($('#stop'))$('#stop').onclick=()=>action('/api/send/stop','POST',{},'Stop requested. The current email may finish.');
  drawProgress();
}
function updateApprovalButton(){const b=$('#approve');if(b)b.disabled=state.active||state.reviewed||state.readiness.length>0||!Object.values(checks).every(Boolean);}
function drawProgress(){
  const box=$('#live-progress');if(!box)return;
  const p=state.progress,completed=p.sent+p.failed,total=Math.max(state.selected_count,completed),pct=total?Math.round(completed/total*100):0;
  box.innerHTML=`<div class="hint"><strong>${esc(p.state.replaceAll('_',' '))}</strong> · ${p.sent} accepted by SMTP · ${p.failed} failed<div class="progress-track"><div class="progress-fill" data-progress="${pct}"></div></div>${p.reason?`<div>${esc(p.reason)}</div>`:''}${state.active?'<div>Keep the local app running while sending. Stop waits for the current SMTP operation.</div>':''}<a href="#" id="go-history">View sending history →</a></div>`;
  $('.progress-fill',box).style.width=pct+'%';$('#go-history').onclick=e=>{e.preventDefault();navigate('history');};
}
function renderHistory(content){
  const events=[...state.events].reverse();
  content.innerHTML=`<section class="card"><div class="section-heading"><div><h2>Sending history</h2><p class="muted">SMTP acceptance means the provider accepted the message. It does not verify inbox delivery.</p></div>${state.active?'<button id="history-stop" class="danger">Stop after current email</button>':''}</div><div id="live-progress"></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Company / email</th><th>Status</th><th>Details</th></tr></thead><tbody>${events.map(e=>`<tr><td>${esc(new Date(e.at).toLocaleString())}</td><td>${esc(e.company)}<small>${esc(e.email)}</small></td><td><span class="badge ${e.status==='sent'?'':'orange'}">${esc(e.status==='sent'?'SMTP accepted':e.status)}</span></td><td>${esc(e.reason || e.meaning || '')}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No emails have been sent from this campaign.</td></tr>'}</tbody></table></div></section>`;
  if($('#history-stop'))$('#history-stop').onclick=()=>action('/api/send/stop','POST',{},'Stop requested.');drawProgress();
}
function discardChanges(){if(dirty&&!confirm('You have unsaved edits. Discard them and continue?'))return false;dirty=false;return true;}
function navigate(next){if(!discardChanges())return;page=next;render();}
$$('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));
$('#close-editor').onclick=()=>$('#editor').close();
$('#recipient-form').onsubmit=async e=>{e.preventDefault();const form=e.target;const data=Object.fromEntries(new FormData(form));await action('/api/recipients/'+data.id,'PATCH',data,'Recipient saved. Review the updated email.');if(!$('#notice').classList.contains('error'))$('#editor').close();};
$('#csv-upload').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(!confirm('Replace the current recipient list with this CSV? A backup of the previous CSV will be kept.'))return;const data=new FormData();data.append('file',file);await action('/api/recipients/import','POST',data,'CSV imported. Review the new recipients.');};
$('#resume-upload').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;const data=new FormData();data.append('file',file);await action('/api/resume','POST',data,'Updated PDF loaded. Review the pages below.');};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
async function poll(){try{const next=await api('/api/state');const wasActive=state?.active;const changed=state&&state.revision!==next.revision;accept(next);if(!dirty&&(changed||wasActive!==state.active||page==='history'))render();else if(!dirty&&page==='review')drawProgress();}catch(error){if(state?.active)notify('Cannot reach the local app. Check the sending history when it reconnects.',true);}}
api('/api/state').then(next=>{accept(next);render();}).catch(error=>{ $('#loading').textContent='Could not load the campaign.';notify(error.message,true);});
setInterval(poll,5000);
