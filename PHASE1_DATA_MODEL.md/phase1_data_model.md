# Phase 1 — Customer and Enquiry Data Model

This first slice adds customer records without changing or migrating existing enquiries.

## `organisations/{organisationId}`

- `name`
- `phone`, `email`
- `billingEmail`
- `paymentTerms`
- `accountManagerEmail`
- `active`
- `createdAt`, `createdByEmail`
- `updatedAt`, `updatedByEmail`

An individual customer is stored as an organisation record using the contact name. This keeps all enquiries linked consistently while allowing the customer model to expand later.

## `customerContacts/{contactId}`

- `organisationId`
- `displayName`
- `phone`, `email`
- `isPrimary`
- `active`
- `updatedAt`, `updatedByEmail`

## `enquiries/{enquiryId}` — schema version 2

- `reference`
- `source`, `channel`
- `status`, `priority`
- `organisationId`, `contactId`
- `customer` snapshot
- `trip` structured journey details
- `assignedToEmail`, `assignedToName`
- `followUpDate`
- `notes`
- `aiProcessingStatus`
- `createdAt`, `createdByEmail`, `createdByUid`
- `updatedAt`

Legacy top-level customer and trip fields are also retained so existing portal screens and old enquiry records remain compatible.

## Migration impact

No migration is required. Existing enquiries remain readable and are used as a fallback source for repeat-customer search. New organisation/contact records are created when a new enquiry is saved.

Before production deployment, Firestore rules must permit authorised enquiry-management staff to read and write `organisations`, `customerContacts`, and `enquiries`.
