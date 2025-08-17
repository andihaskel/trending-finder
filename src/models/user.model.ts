export interface User {
  id: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface UserCreate {
  email: string;
  username?: string;
  avatarUrl?: string;
}

export interface UserUpdate {
  username?: string;
  avatarUrl?: string;
  lastLoginAt?: Date;
}
