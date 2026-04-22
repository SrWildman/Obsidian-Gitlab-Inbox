import { requestUrl } from "obsidian";
import {
  GitLabApproval,
  GitLabDiscussion,
  GitLabMR,
  GitLabNote,
  GitLabTodo,
  GitLabUser,
} from "./types";

export class GitLabApi {
  private baseUrl: string;
  private token: string;
  private username: string | null = null;

  constructor(hostname: string, token: string) {
    this.baseUrl = `https://${hostname}/api/v4`;
    this.token = token;
  }

  private async get<T>(path: string): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}/${path}`;
    const response = await requestUrl({
      url,
      method: "GET",
      headers: {
        "PRIVATE-TOKEN": this.token,
        "Content-Type": "application/json",
      },
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(`GitLab API error ${response.status}: ${path}`);
    }

    return response.json as T;
  }

  private async post<T>(path: string): Promise<T> {
    const response = await requestUrl({
      url: `${this.baseUrl}/${path}`,
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": this.token,
        "Content-Type": "application/json",
      },
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(`GitLab API error ${response.status}: ${path}`);
    }

    return response.json as T;
  }

  private async getWithTotal(path: string): Promise<{ data: GitLabMR[]; total: number }> {
    const url = `${this.baseUrl}/${path}`;
    const response = await requestUrl({
      url,
      method: "GET",
      headers: {
        "PRIVATE-TOKEN": this.token,
        "Content-Type": "application/json",
      },
      throw: false,
    });

    if (response.status >= 400) {
      throw new Error(`GitLab API error ${response.status}: ${path}`);
    }

    const total = parseInt(response.headers["x-total"] ?? response.headers["X-Total"] ?? "0", 10);
    return { data: response.json as GitLabMR[], total };
  }

  async getUsername(): Promise<string> {
    if (this.username) return this.username;
    const user = await this.get<GitLabUser>("user");
    this.username = user.username;
    return this.username;
  }

  async getReviewerMRs(username: string): Promise<GitLabMR[]> {
    return this.get<GitLabMR[]>(
      `merge_requests?reviewer_username=${username}&state=opened&scope=all&per_page=50`
    );
  }

  async getAuthoredMRs(username: string): Promise<GitLabMR[]> {
    return this.get<GitLabMR[]>(
      `merge_requests?author_username=${username}&state=opened&scope=all&per_page=50`
    );
  }

  async getTodos(): Promise<GitLabTodo[]> {
    return this.get<GitLabTodo[]>("todos?state=pending&per_page=100");
  }

  async getApprovals(projectId: number, mrIid: number): Promise<GitLabApproval> {
    return this.get<GitLabApproval>(
      `projects/${projectId}/merge_requests/${mrIid}/approvals`
    );
  }

  async getNotes(projectId: number, mrIid: number): Promise<GitLabNote[]> {
    return this.get<GitLabNote[]>(
      `projects/${projectId}/merge_requests/${mrIid}/notes?per_page=100`
    );
  }

  async getDiscussions(projectId: number, mrIid: number): Promise<GitLabDiscussion[]> {
    return this.get<GitLabDiscussion[]>(
      `projects/${projectId}/merge_requests/${mrIid}/discussions?per_page=100`
    );
  }

  async getReviewerMRCount(username: string): Promise<{ total: number; oldestCreatedAt: string | null }> {
    const result = await this.getWithTotal(
      `merge_requests?reviewer_username=${username}&state=opened&scope=all&per_page=1`
    );
    const oldest = result.data.length > 0 ? result.data[0].created_at : null;

    if (result.total <= 1) {
      return { total: result.total, oldestCreatedAt: oldest };
    }

    // Fetch the last page to get the oldest MR
    const lastPage = Math.ceil(result.total / 1);
    const lastResult = await this.getWithTotal(
      `merge_requests?reviewer_username=${username}&state=opened&scope=all&per_page=1&page=${lastPage}`
    );
    const oldestFromLast = lastResult.data.length > 0 ? lastResult.data[0].created_at : oldest;

    return { total: result.total, oldestCreatedAt: oldestFromLast };
  }

  async markTodoAsDone(todoId: number): Promise<void> {
    await this.post(`todos/${todoId}/mark_as_done`);
  }
}
