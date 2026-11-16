# Task Reminder App

An Expo (React Native) to-do app that reminds you of tasks by **push notification**, **SMS**, or **phone call**.

- Push reminders are scheduled on the device with `expo-notifications`.
- SMS and call reminders go through the small Node/Twilio backend in [`backend/`](backend/).
- Tasks are saved on the device with AsyncStorage.

## Run the app

```bash
npm install
npx expo install --fix   # line dependency versions up with your Expo SDK
npm start
```

Set these values, either as env vars or in `config.js`:

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_BACKEND_URL` | Backend URL. On a real phone, use your computer's LAN IP, not `localhost`. |
| `EXPO_PUBLIC_USER_PHONE` | The number that receives SMS/calls, in E.164 format (`+14155550123`). |

Time field formats: `5:00 PM`, `5pm`, `17:30`, `in 10 min`, `in 2 hours`. A time that has already passed today is scheduled for tomorrow. Leave the field empty to skip the reminder.

> Note: since SDK 53, Expo Go on Android no longer supports `expo-notifications`. Use a development build (`npx expo run:android`) there.

## Run the backend

```bash
cd backend
cp .env.example .env     # add your Twilio SID, auth token and phone number
npm install
npm start
```

API:

- `POST /api/send-reminder` with `{ phoneNumber, message, type: "sms" | "call", sendAt }` returns `{ id, scheduledFor }`
- `DELETE /api/send-reminder/:id` cancels a pending reminder
- `GET /health`

Pending jobs are held in memory, so a server restart loses them. Use a database plus a job queue for production. On a Twilio trial account, you can only text or call numbers you have verified.

## Tests

```bash
npm test
```
