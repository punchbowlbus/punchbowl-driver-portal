# Microsoft 365 defect email setup

The defect notification function sends email through Microsoft Graph using
OAuth client credentials. No mailbox password is stored in the project.

## 1. Create the sender mailbox

Create or choose a dedicated Microsoft 365 mailbox, for example:

`defects@your-company-domain.com`

## 2. Register the application

In Microsoft Entra admin center:

1. Open **App registrations** and create an application.
2. Record the **Directory (tenant) ID**.
3. Record the **Application (client) ID**.
4. Create a client secret and securely record its value.
5. Add Microsoft Graph **Application** permission `Mail.Send`.
6. Grant tenant admin consent.

For least-privilege production security, use Exchange Online RBAC for
Applications to restrict this application to the dedicated sender mailbox.

## 3. Store values in Firebase Secret Manager

Run each command from the project root. Enter the value only when Firebase
prompts for it.

```bash
firebase functions:secrets:set MS365_TENANT_ID
firebase functions:secrets:set MS365_CLIENT_ID
firebase functions:secrets:set MS365_CLIENT_SECRET
firebase functions:secrets:set MS365_SENDER_EMAIL
```

Do not add these values to `.env`, JavaScript, Git, or chat messages.

## 4. Deploy only after approval

```bash
firebase deploy --only functions:notifyOperationsOnDefectCreated
```

## 5. Configure recipients

1. Sign in to the portal as an administrator.
2. Open **Settings**.
3. Select OCC and Supervisor recipients.
4. Enable **Email notifications**.
5. Save notification settings.

Each selected employee must have a valid email address in their employee
record. Push notifications additionally require that employee to enable alerts
on their device.
