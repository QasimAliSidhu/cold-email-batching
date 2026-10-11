# Fictional review interface

This example reuses the existing local review frontend, with a separate fixture backend calling `senior_support_emailer.build_subject` and `build_email_body`. It is a preview example, not the private campaign backend. Only two fictional recipients are loaded in memory.

Run `pip install -r examples/review_ui/requirements.txt` then `python examples/review_ui/app.py`; open http://127.0.0.1:5056. You can select recipients, edit notes and preview personalized drafts. Sending, credential entry, private resumes and imports are unavailable. The batch validation demo remains `python examples/preview_demo.py`.
