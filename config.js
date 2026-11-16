// URL of the reminder backend in /backend. When testing on a physical phone,
// use your computer's LAN IP (e.g. http://192.168.1.20:3000), not localhost.
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3000';

// Phone number (E.164 format) that receives SMS / call reminders.
export const USER_PHONE = process.env.EXPO_PUBLIC_USER_PHONE || '+1234567890';
