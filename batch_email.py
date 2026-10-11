import configparser
import csv
import re
import smtplib
import time
from datetime import date, datetime
from email.message import EmailMessage
from pathlib import Path


# ---------- SETTINGS ----------

BASE_DIR = Path(__file__).resolve().parent

CREDENTIALS_FILE = BASE_DIR / "credentials.ini"
FRIENDS_FILE = BASE_DIR / "friends1.csv"
LOG_FILE = BASE_DIR / "email_log.csv"

BATCH_ID = 'sample_batch'
DAILY_LIMIT = 10
SECONDS_BETWEEN_EMAILS = 240

# Keep True for the first test. Change to False to send.
DRY_RUN = True

SUBJECT = 'Technical Support opportunities'

EMAIL_TEMPLATE = 'Hello,\n\nI am exploring technical support opportunities and would appreciate your guidance.\n\nBest,\nDemo Sender\n'

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def load_credentials():
    """Load Gmail credentials and résumé path."""
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

    attachment_value = config.get(
        "credentials",
        "attachment_path",
        fallback="",
    ).strip()

    if not gmail_address:
        raise RuntimeError(
            "Add gmail_address to credentials.ini."
        )

    if not app_password:
        raise RuntimeError(
            "Add gmail_app_password to credentials.ini."
        )

    if not attachment_value:
        raise RuntimeError(
            "Add attachment_path to credentials.ini."
        )

    attachment_path = Path(attachment_value).expanduser()

    if not attachment_path.is_absolute():
        attachment_path = BASE_DIR / attachment_path

    if not attachment_path.is_file():
        raise FileNotFoundError(
            f"Resume not found: {attachment_path}"
        )

    return gmail_address, app_password, attachment_path


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


def attach_resume(message, attachment_path):
    """Attach the résumé PDF."""
    message.add_attachment(
        attachment_path.read_bytes(),
        maintype="application",
        subtype="pdf",
        filename=attachment_path.name,
    )


def load_recipients(previously_sent):
    """Read and validate addresses from friends.csv."""
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

        if "email" not in (reader.fieldnames or []):
            raise ValueError(
                "friends.csv must contain an email column."
            )

        for row in reader:
            # First value under the email heading.
            raw_values = [row.get("email", "")]

            # Collect additional unquoted comma-separated values.
            extra_values = row.get(None, [])

            if extra_values:
                raw_values.extend(extra_values)

            combined_value = ",".join(
                value
                for value in raw_values
                if value
            )

            # Accept commas, semicolons, and line breaks.
            addresses = re.split(
                r"[,;\n]+",
                combined_value,
            )

            for address in addresses:
                email = address.strip().lower()

                if not email:
                    continue

                if not EMAIL_PATTERN.fullmatch(email):
                    print(
                        f"Skipping invalid address: {email}"
                    )
                    continue

                if email in previously_sent:
                    print(
                        "Skipping previously emailed "
                        f"address: {email}"
                    )
                    continue

                if email in seen:
                    print(
                        f"Skipping duplicate address: {email}"
                    )
                    continue

                seen.add(email)
                recipients.append(email)

    return recipients


def main():
    previous_records = load_email_records()

    previously_sent = {
        row.get("email", "").strip().lower()
        for row in previous_records
        if row.get("batch_id") == BATCH_ID
        and row.get("status") == "sent"
    }

    sent_today = sum(
        1
        for row in previous_records
        if row.get("batch_id") == BATCH_ID
        and row.get("status") == "sent"
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

    recipients = load_recipients(previously_sent)
    recipients = recipients[:remaining_limit]

    print(f"Eligible recipients: {len(recipients)}")
    print(f"Already sent today: {sent_today}")
    print(f"Remaining daily limit: {remaining_limit}")
    print(f"Dry run: {DRY_RUN}")

    if not recipients:
        print("There are no eligible recipients.")
        return

    if DRY_RUN:
        print("\nRecipients:")

        for number, email in enumerate(
            recipients,
            start=1,
        ):
            print(f"{number}. {email}")

        print("\nNo emails were sent.")
        print(
            "Set DRY_RUN = False after checking the list."
        )
        return

    gmail_address, app_password, attachment_path = (
        load_credentials()
    )

    for number, recipient_email in enumerate(
        recipients,
        start=1,
    ):
        message = EmailMessage()
        message["From"] = gmail_address
        message["To"] = recipient_email
        message["Subject"] = SUBJECT
        message.set_content(EMAIL_TEMPLATE)

        email_was_sent = False

        try:
            attach_resume(
                message,
                attachment_path,
            )

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
                "Waiting 4 minutes before the next email..."
            )
            time.sleep(SECONDS_BETWEEN_EMAILS)


if __name__ == "__main__":
    main()