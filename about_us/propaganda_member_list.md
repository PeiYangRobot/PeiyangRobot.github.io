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

const mainforce = [

    {
        avatar: '',
        name: '',
        title: '',
        desc:'',
        links:[
            {icon:'github', link : ''},
            {icon:'bilibili', link: ''},
            {icon: 'zhihu', link:''},
            {icon:'csdn', link:''},
            {icon:'dji', link:''}
        ]
    },
    

]
const substitute = []
const retirement = [
    {
        avatar: 'https://github.com/SARSfang.png',
        name: '方典',
        title: 'TEL/VX:18720066325',
        desc:'22-24赛季宣传经理',
        links:[
            {icon:'github', link : 'https://github.com/SARSfang'},
            {icon:'bilibili', link: 'https://space.bilibili.com/22491017'},
            {icon:'dji', link:'https://bbs.robomaster.com/user/75365'}
        ]
    },
] 
</script>

<VPTeamPage>
  <VPTeamPageTitle>
    <template #title>北洋机甲宣传组</template>
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