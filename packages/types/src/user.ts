import { Role } from './enums';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
  role?: Role;
}

export interface UpdateUserDto {
  name?: string;
  role?: Role;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}
