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
        // 头像，使用github账号网址+'.png'
        avatar: 'https://github.com/vod-x.png',
        // 想要展示的名称
        name: '夏伍',
        // 联系方式（不想写的写‘无联系方式’）
        title: 'QQ:2665574681',
        // 在队职务，按年份降序排序
        desc:'26赛季项目管理，25赛季英雄电控，24赛季英雄电控',
        //社交网站的账户,按需填写，不想写的删除
        links:[
            {icon:'github', link : 'https://github.com/vod-x'},
            {icon:'bilibili', link: ''},
            {icon: 'zhihu', link:''},
            {icon:'csdn', link:''},
            // rm论坛账号
            {icon:'dji', link:''}
        ]
    },
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
const retirement = [] 
</script>

<VPTeamPage>
  <VPTeamPageTitle>
    <template #title>北洋机甲电控组</template>
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