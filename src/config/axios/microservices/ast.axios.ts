import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export class AxiosASTService {
    private readonly axiosInstance: AxiosInstance;

    constructor() {
        this.axiosInstance = axios.create({
            baseURL: process.env.API_SERVICE_AST_URL,
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        this.setupInterceptors();
    }

    private setupInterceptors() {
        this.axiosInstance.interceptors.request.use(
            (config) => {
                // Modify requests here if needed
                return config;
            },
            (error) => {
                return Promise.reject(error);
            },
        );

        this.axiosInstance.interceptors.response.use(
            (response) => {
                // Return data directly
                return response;
            },
            (error) => {
                // Error handling
                return Promise.reject(error);
            },
        );
    }

    // Methods for encapsulating axios calls
    public async get<T = any>(
        url: string,
        config: AxiosRequestConfig = {},
    ): Promise<T> {
        const { data } = await this.axiosInstance.get(url, config);
        return data;
    }

    public async post<T = any>(
        url: string,
        body: Record<string, unknown> = {},
        config: AxiosRequestConfig = {},
    ): Promise<T> {
        const { data } = await this.axiosInstance.post(url, body, config);
        return data;
    }

    public async delete<T = any>(
        url: string,
        config: AxiosRequestConfig = {},
    ): Promise<T> {
        const { data } = await this.axiosInstance.delete(url, config);
        return data;
    }

    public async put<T = any>(
        url: string,
        body: Record<string, unknown> = {},
        config: AxiosRequestConfig = {},
    ): Promise<T> {
        const { data } = await this.axiosInstance.put(url, body, config);
        return data;
    }
}
