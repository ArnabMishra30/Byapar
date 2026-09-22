import { apiClient } from "./client";
import { User, ApiSuccessResponse, Pagination } from "@/types/api";

export interface ListUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: "ADMIN" | "STAFF";
  isActive?: boolean;
}

export interface ListUsersResult {
  users: User[];
  pagination: Pagination;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "STAFF";
}

export interface UpdateUserPayload {
  name?: string;
  role?: "ADMIN" | "STAFF";
}

export const userApi = {
  listUsers: async (params?: ListUsersParams): Promise<ListUsersResult> => {
    const res = await apiClient.get<ApiSuccessResponse<ListUsersResult>>(
      "/users",
      { params }
    );
    return res.data.data;
  },

  getUserById: async (id: string): Promise<User> => {
    const res = await apiClient.get<ApiSuccessResponse<{ user: User }>>(
      `/users/${id}`
    );
    return res.data.data.user;
  },

  createUser: async (payload: CreateUserPayload): Promise<User> => {
    const res = await apiClient.post<ApiSuccessResponse<{ user: User }>>(
      "/users",
      payload
    );
    return res.data.data.user;
  },

  updateUser: async (
    id: string,
    payload: UpdateUserPayload
  ): Promise<User> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ user: User }>>(
      `/users/${id}`,
      payload
    );
    return res.data.data.user;
  },

  updateUserStatus: async (
    id: string,
    isActive: boolean
  ): Promise<User> => {
    const res = await apiClient.patch<ApiSuccessResponse<{ user: User }>>(
      `/users/${id}/status`,
      { isActive }
    );
    return res.data.data.user;
  },
};
