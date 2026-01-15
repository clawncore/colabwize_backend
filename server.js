const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'https://emcjywwqlrxdjfxiwnxi.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtY2p5d3dxbHJ4ZGpmeGl3bnhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MjM2MDQsImV4cCI6MjA3NTQ5OTYwNH0.B-Rj52xJEeKynSBYDVrYNlmixqCN2ZyXfaPQi6oQYmY';
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Basic health check endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'ColabWize Backend API is running!',
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Documents endpoint
app.get('/api/documents', async (req, res) => {
    try {
        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.substring(7);

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Fetch documents from Supabase
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('Supabase error:', error);
            // Return empty array if table doesn't exist yet
            return res.status(200).json({
                success: true,
                data: []
            });
        }

        res.status(200).json({
            success: true,
            data: data || []
        });
    } catch (error) {
        console.error('Documents error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Subscription endpoint
app.get('/api/subscription/current', async (req, res) => {
    try {
        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.substring(7);

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Fetch subscription data from Supabase
        const { data: subscription, error: subError } = await supabase
            .from('user_subscriptions')
            .select('*, plans:subscription_plans(*)')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .single();

        // Fetch usage data
        const { data: usage, error: usageError } = await supabase
            .from('user_usage')
            .select('*')
            .eq('user_id', user.id)
            .single();

        // Default values if no data found
        const subscriptionData = subscription || {
            id: null,
            plan_id: 'free',
            status: 'active',
            start_date: new Date().toISOString()
        };

        const limitsData = subscription?.plans?.limits || {
            scans_per_month: 10,
            certificate_retention_days: 30
        };

        const usageData = usage || { scan: 0 };

        res.status(200).json({
            success: true,
            subscription: subscriptionData,
            limits: limitsData,
            usage: usageData
        });
    } catch (error) {
        console.error('Subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Onboarding endpoint
app.get('/api/onboarding/status', async (req, res) => {
    try {
        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.substring(7);

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Fetch onboarding status from Supabase
        const { data, error } = await supabase
            .from('user_onboarding')
            .select('*')
            .eq('user_id', user.id)
            .single();

        // Default onboarding status if not found
        const onboardingData = data || {
            completed: false,
            skipped: false,
            hasUploaded: false,
            shouldShowTour: true
        };

        res.status(200).json({
            success: true,
            data: onboardingData
        });
    } catch (error) {
        console.error('Onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Analytics endpoints
app.get('/api/analytics/trends', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: []
        });
    } catch (error) {
        console.error('Analytics trends error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

app.get('/api/analytics/summary', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: {
                totalDocuments: 0,
                totalCollaborators: 0,
                totalProjects: 0
            }
        });
    } catch (error) {
        console.error('Analytics summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

app.get('/api/analytics/dashboard', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: {
                recentActivity: [],
                documentTypes: [],
                collaborationMetrics: {}
            }
        });
    } catch (error) {
        console.error('Dashboard analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Authorship endpoints
app.get('/api/authorship/certificates', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: []
        });
    } catch (error) {
        console.error('Authorship certificates error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

app.get('/api/authorship/verification-time', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: {
                averageVerificationTime: '24 hours',
                fastestTime: '2 hours',
                slowestTime: '72 hours',
                currentQueueSize: 0
            }
        });
    } catch (error) {
        console.error('Authorship verification time error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Citations endpoint
app.get('/api/citations/summary', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            data: {
                totalCitations: 0,
                pendingCitations: 0,
                verifiedCitations: 0
            }
        });
    } catch (error) {
        console.error('Citations summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;