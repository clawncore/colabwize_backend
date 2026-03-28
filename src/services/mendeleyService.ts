import axios from "axios";

export class MendeleyService {
    static async fetchLibrary(accessToken: string, limit: number = 50, start: number = 0) {
        try {
            const response = await axios.get("https://api.mendeley.com/documents", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.mendeley-document.1+json"
                },
                params: {
                    limit,
                    view: "all"
                }
            });
            return response.data;
        } catch (error: any) {
            console.error("Mendeley fetchLibrary config error:", error.response?.data || error.message);
            throw error;
        }
    }

    static async queryItems(accessToken: string, query: string) {
        try {
            const response = await axios.get("https://api.mendeley.com/search/catalog", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.mendeley-document.1+json"
                },
                params: {
                    title: query,
                    limit: 50,
                    view: "all"
                }
            });
            return response.data;
        } catch (error: any) {
            console.error("Mendeley queryItems Error:", error.response?.data || error.message);
            throw error;
        }
    }
}
