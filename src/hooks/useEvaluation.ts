import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from './useAuth'

// 会社で隊員評価機能がオンか（スーパー管理者が会社ごとに切り替える）
export function useEvaluationEnabled(): boolean {
  const { user } = useAuth()
  const { data } = useQuery<{ enabled: boolean }>({
    queryKey: ['evaluation-config', user?.company?.id],
    queryFn: () => api.get('/evaluations/config').then(r => r.data),
    enabled: !!user,
    staleTime: 5 * 60_000,
  })
  return !!data?.enabled
}
