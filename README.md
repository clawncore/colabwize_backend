# CollaborateWise Backend

## Overview
This repository contains the backend services for the CollaborateWise application, including API services, authentication, and database management.

## Architecture
The backend consists of:
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **API Services**: RESTful APIs for core business logic
- **Real-time**: Supabase Realtime for collaborative features

## Database Schema
The database is managed through Supabase. Schema definitions and migrations are located in the `supabase/` directory.

## Services
The application uses various backend services:

### Authentication Service
Handles user registration, login, and session management using Supabase Auth.
- `/api/auth/hybrid/signup` - User registration with email verification
- `/api/auth/hybrid/reset-password` - Password reset functionality
- `/api/auth/hybrid/verify-otp` - Email OTP verification
- `/api/auth/hybrid/resend-verification` - Resend verification codes

### Document Service
Manages document creation, storage, retrieval, and sharing functionality.

### Profile Service
Handles user profile management and settings.

### Subscription Service
Manages user subscriptions and billing.

### Analytics Service
Tracks usage metrics and user engagement.

## API Endpoints
Core API functionality includes:
- User authentication and authorization
- Document management
- Collaboration features
- Billing and subscription management
- Analytics and reporting

## Environment Variables
Backend configuration requires the following environment variables:
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `JWT_SECRET` - JWT signing secret
- `DATABASE_URL` - PostgreSQL database connection string

## Deployment
The backend is deployed using Supabase cloud services. Database migrations and edge functions are handled through the Supabase platform.

## Local Development
1. Set up Supabase locally or connect to the hosted instance
2. Configure environment variables
3. Run the development server with proper database connectivity

## Security
- All API requests are authenticated using Supabase JWT tokens
- Row-level security (RLS) policies are enforced in the database
- Input validation is performed on all endpoints
- Rate limiting is implemented for API endpoints