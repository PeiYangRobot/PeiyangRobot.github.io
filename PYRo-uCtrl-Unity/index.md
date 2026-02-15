
---
contributors: 
  - mem1
  - mem3
---
<script setup>

import { VPTeamMembers } from 'vitepress/theme'

import { 
  mem1, 
} from '../public/member_list/members'

</script>

北洋机甲嵌入式开发框架

<VPTeamMembers size="small" :members="[mem1]" />