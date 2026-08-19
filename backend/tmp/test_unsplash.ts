import axios from 'axios';

const UNSPLASH_ACCESS_KEY = 'FKmyEygH5avUFsHlEM0CPhNLFHjOu0hJTKelPt1Ibk';
const UNSPLASH_API_URL = 'https://api.unsplash.com';

async function testUnsplash() {
    try {
        console.log('Testing Unsplash API with key:', UNSPLASH_ACCESS_KEY);
        const response = await axios.get(`${UNSPLASH_API_URL}/search/photos`, {
            params: { query: 'test' },
            headers: {
                'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`,
                'Accept-Version': 'v1'
            }
        });
        console.log('✅ Success! Data fetched:', response.data.results.length, 'results');
    } catch (error: any) {
        console.error('❌ Failed to fetch from Unsplash');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }
    }
}

testUnsplash();
