"""Isolated example using the existing review frontend and real email templates.
Only fictional fixtures are loaded. No SMTP, credentials or campaign files.
pip install flask; python examples/review_ui/app.py
"""
from pathlib import Path
import sys, copy
from flask import Flask, jsonify, request, render_template
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import senior_support_emailer as emailer

def create_app():
    app=Flask(__name__)
    rows=[dict(id='alex',name='Alex',company='Atlas Support',email='alex@atlas-support.example',note="I enjoyed your team's public support engineering article.",selected=True),dict(id='morgan',name='Morgan',company='Harbor',email='morgan@harbor.example',note='Your sample API documentation caught my attention.',selected=True)]
    revision=0
    def state():
        prepared=[]
        for row in rows:
            r=copy.deepcopy(row)
            r.update(contact_kind='recruiting',delivery_status='draft',email_sources=[],note_sources=[],subject_override=r.get('subject_override',''),body_override=r.get('body_override',''))
            r['preview']={'from_name':'Demo Sender','from':'demo@sender.example','subject':r['subject_override'] or emailer.build_subject(r),'body':r['body_override'] or emailer.build_email_body(r)}
            prepared.append(r)
        return dict(rows=prepared,total=len(rows),selected_count=sum(r['selected'] for r in rows),revision=revision,active=False,reviewed=False,skipped=[{'company':x,'reason':y} for x,y in [('Duplicate row','Duplicate address'),('Prior contact','Already contacted'),('Invalid address','Address validation failed'),('Missing note','Personalization note required')]],config=dict(resume_mode='url',resume_url=emailer.RESUME_URL,seconds_between_emails=emailer.SECONDS_BETWEEN_EMAILS,batch_limit=emailer.DAILY_LIMIT,sender_name='Demo Sender',subject_template=emailer.DEFAULT_SUBJECT,body_template=emailer.EMAIL_TEMPLATE),resume=dict(name='No private resume loaded',exists=False,bytes=0,sha256='sample'),credentials=dict(configured=False,connected=False,authentication=None),readiness=['Sending disabled in this sample.'],estimated_minutes=4,progress=dict(state='idle',sent=0,failed=0,reason='Sample preview only'),events=[])
    @app.get('/')
    def home():return render_template('index.html',csrf='sample-preview-token')
    @app.get('/api/state')
    def get_state():return jsonify(state())
    @app.before_request
    def protect():
        if request.method!='GET' and request.headers.get('X-Review-Token')!='sample-preview-token':return jsonify(error='Sample token required'),403
    @app.patch('/api/recipients/<row_id>')
    def edit(row_id):
        nonlocal revision
        row=next((r for r in rows if r['id']==row_id),None)
        if not row:return jsonify(error='Unknown sample recipient'),404
        data=request.get_json() or {}
        for k in ['name','company','email','note','selected','subject_override','body_override']:
            if k in data:row[k]=data[k]
        revision+=1
        return jsonify(state())
    @app.post('/api/select')
    def select():
        nonlocal revision
        value=bool((request.get_json() or {}).get('selected'))
        for row in rows:row['selected']=value
        revision+=1
        return jsonify(state())
    @app.route('/api/<path:path>',methods=['GET','POST','PATCH','PUT','DELETE'])
    def disabled(path):return jsonify(error='Unavailable in the sample: no sending, credentials, private files or imports.'),403
    return app

if __name__=='__main__':create_app().run(host='127.0.0.1',port=5056)
