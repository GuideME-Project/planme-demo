// Public homepage media is served directly from S3, independently of Vercel deployments.
const homeMediaBaseUrl = "https://s3.ap-northeast-2.amazonaws.com/planme.kr/home";

export function homeMediaUrl(fileName: string): string {
  return `${homeMediaBaseUrl}/${fileName}`;
}
