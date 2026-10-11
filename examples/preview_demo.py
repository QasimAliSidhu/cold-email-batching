from pathlib import Path
import contextlib, csv, io, sys, tempfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import senior_support_emailer as app

def blocked(*args, **kwargs):
    raise RuntimeError("SMTP and credential loading are disabled in the sample demo")

def run():
    with tempfile.TemporaryDirectory(prefix="email-preview-") as folder:
        root=Path(folder)
        app.FRIENDS_FILE=root/"sample.csv"
        app.PREVIOUSLY_CONTACTED_FILE=root/"previous.csv"
        app.LOG_FILE=root/"log.csv"
        app.DRY_RUN=True
        app.smtplib.SMTP_SSL=blocked
        app.load_credentials=blocked
        rows=[
            ["alex@atlas-support.example","Alex","Atlas Support","I enjoyed your team's public support engineering article"],
            ["alex@atlas-support.example","Alex","Atlas Support","Duplicate row"],
            ["blair@northstar.example","Blair","Northstar","A fictional prior contact"],
            ["invalid-address","Casey","Example","A sample invalid address"],
            ["morgan@harbor.example","Morgan","Harbor","Your sample API documentation caught my attention"],
            ["no-note@example.test","Taylor","Example",""]]
        with app.FRIENDS_FILE.open("w",newline="",encoding="utf-8") as f:
            writer=csv.writer(f);writer.writerow(["email","name","company","note"]);writer.writerows(rows)
        app.PREVIOUSLY_CONTACTED_FILE.write_text("email\nblair@northstar.example\n",encoding="utf-8")
        app.LOG_FILE.write_text("batch_id,email,status,details,sent_at\n",encoding="utf-8")
        output=io.StringIO()
        with contextlib.redirect_stdout(output): app.main()
        return output.getvalue()

if __name__=="__main__": print(run())
