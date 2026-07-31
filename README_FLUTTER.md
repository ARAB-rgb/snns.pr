# SNNS App - Flutter Web & Mobile Project Setup Instructions

## 1. Local Flutter Setup & Running
To run this project with standard Flutter CLI:

```bash
# 1. Install dependencies
flutter pub get

# 2. Format Dart code
dart format .

# 3. Analyze code for issues
flutter analyze

# 4. Run on Flutter Web
flutter run -d chrome

# 5. Build production Web release for Hostinger
flutter build web --release
```

## 2. Environment Variables (.env)
Set the following keys in your `.env` or Supabase configuration:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ZEGO_APP_ID=366567418
```

## 3. Database Deployment (Supabase)
Execute the contents of `supabase_schema.sql` in your Supabase SQL Editor to provision all tables, indexes, triggers, and Row Level Security (RLS) policies for:
- `profiles`
- `conversations`
- `conversation_members`
- `messages`
- `message_reads`
- `calls`
- `call_participants`
- `statuses`
- `status_views`
- `blocked_users`
- `reports`
- `notifications`

## 4. Hostinger Deployment
1. Run `flutter build web --release`.
2. Upload the output contents inside `build/web/` to your Hostinger `public_html/` folder.
3. Make sure the `.htaccess` file provided in this repository is copied to your `public_html/` root for single-page routing support.
