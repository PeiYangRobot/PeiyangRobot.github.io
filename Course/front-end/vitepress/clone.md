<script setup>
import { VPTeamMembers } from 'vitepress/theme'

import { 
  mem1, 
} from '../../../public/member_list/members'
</script>
Author
--- 
<VPTeamMembers size="small" :members="[mem1]" />
