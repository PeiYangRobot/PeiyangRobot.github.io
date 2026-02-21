---
layout: page
---
<script setup>
import {
  VPTeamPage,
  VPTeamPageTitle,
  VPTeamMembers,
  VPTeamPageSection
} from 'vitepress/theme'
import { 
         mem5,
         mem6,
 } from '../public/member_list/members'

const mainforce = []
const substitute = []
const retirement = [
    mem5,
    mem6,
    ]
</script>

<VPTeamPage>
  <VPTeamPageTitle>
    <template #title>北洋机甲算法组</template>
  </VPTeamPageTitle>
  <VPTeamPageSection>
    <template #title>现役队员</template>
    <template #lead>本赛季在队的主力队员</template>
  </VPTeamPageSection>
  <VPTeamMembers size="small" :members="mainforce" />
  <VPTeamPageSection>
    <template #title>预备队员</template>
    <template #lead>本赛季做出一定奉献的预备队员</template>
    <template #members>
      <VPTeamMembers size="small" :members="substitute" />
    </template>
  </VPTeamPageSection>
  <VPTeamPageSection>
    <template #title>退役老登</template>
    <template #lead>已经退休的老登们</template>
    <template #members>
      <VPTeamMembers size="small" :members="retirement" />
    </template>
  </VPTeamPageSection>
</VPTeamPage>