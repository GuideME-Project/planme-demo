# PlanME Demo 에이전트 작업 규칙

- 이 작업 공간의 상위 Codex 안전 규칙을 따릅니다.
- 이 프로젝트에서 작업할 때 `node_modules` 또는 `dist`를 읽거나 검색하지 않습니다.
- Next.js와 MUI 동작은 공식 프레임워크 문서 또는 로컬 빌드 출력으로 검증합니다.
- 이 데모는 PlanME 링크 전달, OpenGraph 메타데이터, 여행 일정 상세 화면에 집중합니다. Custom GPT Actions·MCP 연동(`apps/mcp`)은 GUI-337에서 제거했습니다.

## 브랜치와 배포

- 이 프로젝트의 기준 브랜치는 `main`입니다. `develop`을 기본 기준 브랜치로 사용하지 않습니다.
- 운영 서비스는 AWS(ECS Fargate + ALB)에서 실행하며 Vercel은 사용하지 않습니다.
- 운영 변경은 GitHub PR 생성과 병합 후 GitHub Actions(`Prod Deploy`)가 이미지 빌드·ECR 푸시·ECS 배포를 수행하는 흐름으로만 배포합니다. AWS CLI·Docker로 ECR 이미지나 ECS 서비스를 직접 변경하지 않습니다.
- AWS 리소스(Route 53, ALB 규칙, ECS 서비스, IAM 등)는 `guideme-aws-infra` 저장소의 Terraform PR로만 변경합니다.
