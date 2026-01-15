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
        console.log('Documents endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header or invalid format');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified:', user.id);

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
                data: [],
                message: 'No documents found'
            });
        }

        console.log('Documents fetched:', data?.length || 0, 'documents');

        res.status(200).json({
            success: true,
            data: data || []
        });
    } catch (error) {
        console.error('Documents error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Subscription endpoint
app.get('/api/subscription/current', async (req, res) => {
    try {
        console.log('Subscription endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for subscription');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for subscription, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in subscription:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for subscription:', user.id);

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

        console.log('Subscription data fetched for user:', user.id);

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
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Onboarding endpoint
app.get('/api/onboarding/status', async (req, res) => {
    try {
        console.log('Onboarding endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for onboarding');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for onboarding, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in onboarding:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for onboarding:', user.id);

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

        console.log('Onboarding data fetched for user:', user.id);

        res.status(200).json({
            success: true,
            data: onboardingData
        });
    } catch (error) {
        console.error('Onboarding error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Analytics endpoints
app.get('/api/analytics/trends', async (req, res) => {
    try {
        console.log('Analytics trends endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for analytics');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for analytics trends, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in analytics:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for analytics trends:', user.id);

        // Fetch analytics data from Supabase
        const { data, error } = await supabase
            .from('user_analytics')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Analytics trends error:', error);
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
        console.error('Analytics trends error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/analytics/summary', async (req, res) => {
    try {
        console.log('Analytics summary endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for analytics summary');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for analytics summary, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in analytics summary:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for analytics summary:', user.id);

        // Fetch analytics summary from Supabase
        const { data, error } = await supabase
            .from('user_analytics_summary')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (error) {
            console.error('Analytics summary error:', error);
            // Return default values if table doesn't exist yet
            return res.status(200).json({
                success: true,
                data: {
                    totalDocuments: 0,
                    totalCollaborators: 0,
                    totalProjects: 0
                }
            });
        }

        res.status(200).json({
            success: true,
            data: data || {
                totalDocuments: 0,
                totalCollaborators: 0,
                totalProjects: 0
            }
        });
    } catch (error) {
        console.error('Analytics summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/analytics/dashboard', async (req, res) => {
    try {
        console.log('Dashboard analytics endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for dashboard analytics');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for dashboard analytics, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in dashboard analytics:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for dashboard analytics:', user.id);

        // Fetch dashboard analytics from Supabase
        const { data: activityData, error: activityError } = await supabase
            .from('user_recent_activity')
            .select('*')
            .eq('user_id', user.id)
            .limit(10)
            .order('created_at', { ascending: false });

        const { data: docTypeData, error: docTypeError } = await supabase
            .from('user_document_types')
            .select('*')
            .eq('user_id', user.id);

        if (activityError || docTypeError) {
            console.error('Dashboard analytics error:', activityError || docTypeError);
            // Return default values if tables don't exist yet
            return res.status(200).json({
                success: true,
                data: {
                    recentActivity: [],
                    documentTypes: [],
                    collaborationMetrics: {}
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                recentActivity: activityData || [],
                documentTypes: docTypeData || [],
                collaborationMetrics: {}
            }
        });
    } catch (error) {
        console.error('Dashboard analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Authorship endpoints
app.get('/api/authorship/certificates', async (req, res) => {
    try {
        console.log('Authorship certificates endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for authorship');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for authorship certificates, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in authorship:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for authorship certificates:', user.id);

        // Fetch certificates from Supabase
        const { data, error } = await supabase
            .from('authorship_certificates')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Authorship certificates error:', error);
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
        console.error('Authorship certificates error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

app.get('/api/authorship/verification-time', async (req, res) => {
    try {
        console.log('Authorship verification time endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for authorship verification');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for authorship verification, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in authorship verification:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for authorship verification:', user.id);

        // Fetch verification time data from Supabase
        const { data, error } = await supabase
            .from('authorship_verification_stats')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (error) {
            console.error('Authorship verification time error:', error);
            // Return default values if table doesn't exist yet
            return res.status(200).json({
                success: true,
                data: {
                    averageVerificationTime: '24 hours',
                    fastestTime: '2 hours',
                    slowestTime: '72 hours',
                    currentQueueSize: 0
                }
            });
        }

        res.status(200).json({
            success: true,
            data: data || {
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
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Citations endpoint
app.get('/api/citations/summary', async (req, res) => {
    try {
        console.log('Citations summary endpoint called');
        console.log('Request headers:', req.headers);

        // Get authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('No authorization header for citations');
            return res.status(401).json({
                success: false,
                error: 'Unauthorized',
                message: 'No authorization token provided'
            });
        }

        const token = authHeader.substring(7);
        console.log('Token received for citations summary, attempting to get user...');

        // Get user from token
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError) {
            console.error('User error in citations:', userError);
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                message: userError.message
            });
        }

        console.log('User identified for citations summary:', user.id);

        // Fetch citations summary from Supabase
        const { data, error } = await supabase
            .from('citations')
            .select('*')
            .eq('user_id', user.id);

        if (error) {
            console.error('Citations summary error:', error);
            // Return default values if table doesn't exist yet
            return res.status(200).json({
                success: true,
                data: {
                    totalCitations: 0,
                    pendingCitations: 0,
                    verifiedCitations: 0
                }
            });
        }

        // Calculate summary stats
        const totalCitations = data.length;
        const pendingCitations = data.filter(citation => citation.status === 'pending').length;
        const verifiedCitations = data.filter(citation => citation.status === 'verified').length;

        res.status(200).json({
            success: true,
            data: {
                totalCitations,
                pendingCitations,
                verifiedCitations
            }
        });
    } catch (error) {
        console.error('Citations summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
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