export interface Trend {
  id: string;
  keyword: string;
  platforms: string[];
  timeframe: string;
  lang?: string;
  region?: string;
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrendCreate {
  keyword: string;
  platforms: string[];
  timeframe: string;
  lang?: string;
  region?: string;
  userId?: string;
}

export interface TrendUpdate {
  keyword?: string;
  platforms?: string[];
  timeframe?: string;
  lang?: string;
  region?: string;
}

export interface TrendPost {
  id: string;
  trendId: string;
  postId: string;
  platform: string;
  createdAt: Date;
}

export interface TrendPostCreate {
  trendId: string;
  postId: string;
  platform: string;
}
