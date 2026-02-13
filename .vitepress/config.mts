import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "PYRo",
  description: "天津大学北洋机甲文档站",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    siteTitle: "PeiYang Robot",    
    logo: '/figure/校徽.png',
    nav: [

      { text: '嵌入式框架', link: '/PYRo-uCtrl-Unity/index' },
      { text: '新生培训', 
        items: [
          { text: '电控培训', link: '' },
          { text: '机械培训', link: '' },
          { text: '硬件培训', link: '' },
          { text: '算法培训', link: '' },
          { text: '通识培训', link: '' },
          { text: 'RM培训', link: '' },
        ]
      },
      { text: '教程', link: '/' },
      { text: '队史馆', link: '/' },
      
    ],


 sidebar: {
      '/PYRo-uCtrl-Unity': [
        {
          text: 'PYRo-uCtrl-Unity',
          items: [
            { text: '简介', link: '/PYRo-uCtrl-Unity/index' },
            { text: '开发者', link: '/PYRo-uCtrl-Unity/team' },
            { text: '使用教程', link: '/PYRo-uCtrl-Unity/tutorial' },
          ]
        }
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/PeiYangRobot' },
      { icon: 'bilibili', link: 'https://space.bilibili.com/520634089?spm_id_from=333.337.0.0' },
      { icon: 'dji', link:'https://www.robomaster.com/zh-CN'}
    ],
    footer: {
      copyright: 'Copyright © 2026 - prsent PeiYang Robot'
    }

  }
})
