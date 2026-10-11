import configparser
import csv
import re
import smtplib
import time
from datetime import date, datetime
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path


# ---------- SETTINGS ----------

BASE_DIR = Path(__file__).resolve().parent

CREDENTIALS_FILE = BASE_DIR / "credentials.ini"
FRIENDS_FILE = BASE_DIR / "friends_with_customized_notes.csv"
PREVIOUSLY_CONTACTED_FILE = BASE_DIR / "previously_contacted.csv"
LOG_FILE = BASE_DIR / "email_log.csv"

BATCH_ID = 'sample_batch'
DAILY_LIMIT = 10
SECONDS_BETWEEN_EMAILS = 240

# Keep this True until every personalized preview has been checked.
DRY_RUN = True

DEFAULT_SUBJECT = (
    "Senior Software Support Engineer opportunities"
)

# Public, view-only CV link. This is the only link included in the email.
RESUME_URL = 'https://portfolio.example/cv'

UNKNOWN_COMPANY_TEXT = "not identifiable from email"

EMAIL_TEMPLATE = 'Hi {name},\n\n{note}\n\nI am exploring technical support opportunities{company_reference}. I would appreciate your guidance on relevant openings.\n\nPortfolio: {resume_url}\n\nBest,\nDemo Sender\n'

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def load_credentials():
    """Load the Gmail credentials used for SMTP."""
    if not CREDENTIALS_FILE.is_file():
        raise FileNotFoundError(
            f"Credentials file not found: {CREDENTIALS_FILE}"
        )

    config = configparser.ConfigParser(interpolation=None)
    config.read(CREDENTIALS_FILE, encoding="utf-8")

    if not config.has_section("credentials"):
        raise RuntimeError(
            "credentials.ini must contain a [credentials] section."
        )

    gmail_address = config.get(
        "credentials",
        "gmail_address",
        fallback="",
    ).strip()

    app_password = config.get(
        "credentials",
        "gmail_app_password",
        fallback="",
    ).replace(" ", "").strip()

    if not gmail_address:
        raise RuntimeError(
            "Add gmail_address to credentials.ini."
        )

    if not app_password:
        raise RuntimeError(
            "Add gmail_app_password to credentials.ini."
        )

    return gmail_address, app_password


def load_email_records():
    """Load previous sending results."""
    if not LOG_FILE.exists():
        return []

    with LOG_FILE.open(
        "r",
        newline="",
        encoding="utf-8",
    ) as file:
        return list(csv.DictReader(file))


def log_result(email, status, details=""):
    """Record a successful or failed sending attempt."""
    file_has_content = (
        LOG_FILE.exists() and LOG_FILE.stat().st_size > 0
    )

    with LOG_FILE.open(
        "a",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "batch_id",
                "email",
                "status",
                "details",
                "sent_at",
            ],
        )

        if not file_has_content:
            writer.writeheader()

        writer.writerow(
            {
                "batch_id": BATCH_ID,
                "email": email,
                "status": status,
                "details": details,
                "sent_at": datetime.now().isoformat(
                    timespec="seconds"
                ),
            }
        )


def load_previously_contacted():
    """Load addresses contacted before this script began logging."""
    if not PREVIOUSLY_CONTACTED_FILE.is_file():
        raise FileNotFoundError(
            f"Create {PREVIOUSLY_CONTACTED_FILE.name} with an email "
            "column. Add everyone contacted before this script existed. "
            "If there are no older contacts, leave only the email header."
        )

    addresses = set()

    with PREVIOUSLY_CONTACTED_FILE.open(
        "r",
        newline="",
        encoding="utf-8-sig",
    ) as file:
        reader = csv.DictReader(file)

        if "email" not in (reader.fieldnames or []):
            raise ValueError(
                "previously_contacted.csv must contain an email column."
            )

        for row in reader:
            email = row.get("email", "").strip().lower()

            if not email:
                continue

            if not EMAIL_PATTERN.fullmatch(email):
                raise ValueError(
                    "Invalid address in previously_contacted.csv: "
                    f"{email}"
                )

            addresses.add(email)

    return addresses


def clean_personal_text(value):
    """Collapse CSV whitespace and keep header/body fields on one line."""
    return " ".join(value.split())


def clean_company(value):
    """Treat the CSV's unknown-company label as a missing company."""
    company = clean_personal_text(value)

    if company.casefold() == UNKNOWN_COMPANY_TEXT.casefold():
        return ""

    return company


def get_resume_url():
    """Return the required public CV URL."""
    resume_url = RESUME_URL.strip()

    if not resume_url:
        raise ValueError("Add the public CV link to RESUME_URL")

    if not resume_url.startswith("https://"):
        raise ValueError("RESUME_URL must begin with https://")

    return resume_url


def build_subject(recipient):
    """Use the company only when it makes the subject genuinely specific."""
    company = recipient["company"]

    if company:
        return (
            "Senior Software Support Engineer opportunities "
            f"at {company}"
        )

    return DEFAULT_SUBJECT


def build_email_body(recipient):
    """Create one message from the recipient's personal context."""
    company = recipient["company"]
    company_reference = f" at {company}" if company else ""

    return EMAIL_TEMPLATE.format(
        name=recipient["name"],
        note=recipient["note"],
        company_reference=company_reference,
        resume_url=get_resume_url(),
    )


def load_recipients(blocked_addresses):
    """Read personalized recipient records and exclude every prior contact."""
    if not FRIENDS_FILE.is_file():
        raise FileNotFoundError(
            f"Cannot find {FRIENDS_FILE}"
        )

    recipients = []
    seen = set()

    with FRIENDS_FILE.open(
        "r",
        newline="",
        encoding="utf-8-sig",
    ) as file:
        reader = csv.DictReader(file)

        required_columns = {
            "email",
            "name",
            "company",
            "note",
        }
        available_columns = set(reader.fieldnames or [])
        missing_columns = required_columns - available_columns

        if missing_columns:
            raise ValueError(
                f"{FRIENDS_FILE.name} is missing required columns: "
                + ", ".join(sorted(missing_columns))
            )

        for row in reader:
            email = row.get("email", "").strip().lower()
            name = clean_personal_text(
                row.get("name", "")
            )
            company = clean_company(
                row.get("company", "")
            )
            note = clean_personal_text(
                row.get("note", "")
            )

            if not email:
                continue

            if not EMAIL_PATTERN.fullmatch(email):
                print(f"Skipping invalid address: {email}")
                continue

            if email in blocked_addresses:
                print(f"Skipping previously contacted address: {email}")
                continue

            if email in seen:
                print(f"Skipping duplicate address: {email}")
                continue

            if not name or not note:
                print(
                    "Skipping unpersonalized address: "
                    f"{email} (name and note are required)"
                )
                continue

            if note[-1] not in ".!?":
                note += "."

            seen.add(email)
            recipients.append(
                {
                    "email": email,
                    "name": name,
                    "company": company,
                    "note": note,
                }
            )

    return recipients


def main():
    previous_records = load_email_records()

    previously_sent = {
        row.get("email", "").strip().lower()
        for row in previous_records
        if row.get("status") == "sent"
    }

    previously_contacted = load_previously_contacted()
    blocked_addresses = previously_sent | previously_contacted

    sent_today = sum(
        1
        for row in previous_records
        if row.get("status") == "sent"
        and row.get("sent_at", "").startswith(
            date.today().isoformat()
        )
    )

    remaining_limit = max(
        0,
        DAILY_LIMIT - sent_today,
    )

    if remaining_limit == 0:
        print(
            "The daily limit has already been reached."
        )
        return

    recipients = load_recipients(blocked_addresses)
    recipients = recipients[:remaining_limit]

    print(f"Eligible recipients: {len(recipients)}")
    print(f"Already sent today: {sent_today}")
    print(f"Remaining daily limit: {remaining_limit}")
    print(f"Dry run: {DRY_RUN}")

    if not recipients:
        print("There are no eligible recipients.")
        return

    if DRY_RUN:
        print("\nPersonalized previews:")

        for number, recipient in enumerate(
            recipients,
            start=1,
        ):
            print("\n" + "=" * 72)
            print(f"Preview {number}: {recipient['email']}")
            print(f"Subject: {build_subject(recipient)}")
            print()
            print(build_email_body(recipient))

        print("\nNo emails were sent.")
        print(
            "Set DRY_RUN = False after checking the list."
        )
        return

    gmail_address, app_password = load_credentials()

    for number, recipient in enumerate(
        recipients,
        start=1,
    ):
        recipient_email = recipient["email"]
        message = EmailMessage()
        message["From"] = formataddr(("Demo Sender", gmail_address))
        message["To"] = formataddr(
            (recipient["name"], recipient_email)
        )
        message["Subject"] = build_subject(recipient)
        message.set_content(build_email_body(recipient))

        email_was_sent = False

        try:
            # Use a new Gmail connection for every email.
            with smtplib.SMTP_SSL(
                "smtp.gmail.com",
                465,
                timeout=60,
            ) as smtp:
                smtp.login(
                    gmail_address,
                    app_password,
                )
                smtp.send_message(message)

            # Record success only after Gmail accepts it.
            log_result(
                recipient_email,
                "sent",
            )
            email_was_sent = True

            print(
                f"{number}/{len(recipients)} sent: "
                f"{recipient_email}"
            )

        except Exception as error:
            log_result(
                recipient_email,
                "failed",
                str(error),
            )

            print(
                f"Failed: {recipient_email} — {error}"
            )

        if email_was_sent and number < len(recipients):
            print(
                "Waiting 3 minutes before the next email..."
            )
            time.sleep(SECONDS_BETWEEN_EMAILS)


if __name__ == "__main__":
    main()
