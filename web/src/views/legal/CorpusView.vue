<script setup lang="ts">
/**
 * 语料共建说明（公开页，/corpus）。
 *
 * 意图（Why）：
 *   《用户协议》里那一条只写得下"结论"，写不下"到底收什么、不收什么、留在哪、谁能看"。
 *   而这几件事恰恰是用户最可能追问、也最影响信任的部分。因此单独成页，
 *   把采集范围、留存与访问控制、第三方环节一次性讲清，并在用户协议里指向本页。
 *
 *   写作原则（改文案时必须守住）：
 *     1) 只写事实，不写"我们会尽力保护"这类无法验证的承诺；
 *     2) 负面清单必须写全（不采什么），只写"采什么"会让人怀疑还有没说的；
 *     3) 不出现任何具体价格与内部实现细节（那些会随运营调整而失效）。
 *
 * 流转（Flow）：
 *   《用户协议》第六条 / 页脚 → /corpus
 *
 * 扩展（Extend）：
 *   若将来提供"用户自行退出采集"的开关，在本页补一节说明入口位置即可。
 */
import LegalDocLayout from '@/components/LegalDocLayout.vue'
</script>

<template>
  <LegalDocLayout
    title="语料共建说明"
    description="本站的「语料共建计划」：采集哪些模型的对话内容、怎么留存与使用、明确不采集什么。"
    updated-at="2026-09-29"
  >
    <section>
      <h2 class="section-title">一、我们在做什么</h2>
      <p>
        本站是一个 AI 模型接口网关。为了改进与训练我们自己的模型，我们开展「语料共建计划」：
        在你调用<strong>本站声明的共建模型</strong>时，会留存该次调用的
        <strong>请求内容</strong>（含提示词与对话消息）与<strong>模型返回内容</strong>，
        经脱敏与匿名化处理后，用于模型训练与语料数据集建设。
      </p>
      <p>
        这不是"把用户当数据源"——参与共建的范围是公开的、有限的，且只针对我们明确列出的模型；
        其余模型、其余功能不受影响。
      </p>
    </section>

    <section>
      <h2 class="section-title">二、采集范围</h2>
      <p><strong>会采集的内容：</strong></p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>该次调用的<strong>请求体</strong>：包含你提交的提示词、对话消息等内容；</li>
        <li>上游返回的<strong>正文内容</strong>：模型生成的回答（流式与一次性返回都在内）；</li>
        <li>与这次调用相关的技术信息：所用模型名、时间、是否流式、请求与返回的字节数等。</li>
      </ul>
      <p class="mt-3"><strong>明确不采集的内容：</strong></p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li><strong>不采集任何请求头</strong>，因此不包含你的访问令牌、密钥或 Authorization 信息；</li>
        <li>不采集你的 IP 地址、浏览器标识或设备信息；</li>
        <li>不采集未列入共建清单的模型调用；</li>
        <li>不采集调用失败的请求；</li>
        <li>不采集图片、音视频等异步任务的参数与结果。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">三、共建模型清单</h2>
      <p>
        当前纳入共建的是<strong>对话与文本生成类</strong>的国产模型及大参数量模型
        （包括按次计费专线与免费分组中的相应模型）。
        完整的实时清单在站点「模型广场」与站内公告中同步；调整清单会通过站内公告通知。
      </p>
      <p>
        嵌入、内容审核、文档解析、语音翻译、图像与视频检测一类的模型<strong>不在采集范围内</strong>
        ——它们的请求里没有对话内容。
      </p>
    </section>

    <section>
      <h2 class="section-title">四、怎么留存、谁能看到</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>原文仅保存在本站的服务器数据库中，<strong>不对外提供任何公开访问入口</strong>；</li>
        <li>只有站点的运维管理员可以读取；每一次"查看单条原文"与"批量导出"都会留下操作记录；</li>
        <li>界面上的样本列表只显示内容摘要，完整原文需要单独操作并留痕；</li>
        <li>导出到本地后会在<strong>合理期限内</strong>从服务器删除，并在此基础上继续完成脱敏与整理；</li>
        <li>正式纳入训练语料前，会进行脱敏与匿名化处理（去除可识别到个人的信息）。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">五、第三方环节</h2>
      <p>
        本站是网关，负责把请求转发到<strong>第三方模型服务商</strong>的接口。
        因此你提交的内容会经由该服务商传输与处理，
        <strong>其是否留存、如何使用不在本站可控范围内</strong>。
        这一点与"是否参与共建"无关，是所有网络转发服务共有的事实，我们如实告知。
      </p>
    </section>

    <section>
      <h2 class="section-title">六、你的选择</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>
          继续使用本服务即视为同意《用户协议》第六条所述的上述处理；若你不同意，
          请停止调用共建清单内的模型——<strong>其余模型与功能完全不受影响</strong>。
        </li>
        <li>
          如你希望撤回已留存的内容，或对本计划有疑问，
          请通过
          <RouterLink to="/contact" class="text-brand-700 hover:underline">联系方式</RouterLink>
          页与我们联系，我们会在核实身份后处理。
        </li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">七、相关文件</h2>
      <p>
        本说明是
        <RouterLink to="/terms" class="text-brand-700 hover:underline">《用户协议》</RouterLink>
        的组成部分；关于账号与个人信息的其他处理方式，见
        <RouterLink to="/privacy" class="text-brand-700 hover:underline">《隐私政策》</RouterLink>。
        本说明如有更新将在本页公示，重大变更会通过站内公告提醒。
      </p>
    </section>
  </LegalDocLayout>
</template>
