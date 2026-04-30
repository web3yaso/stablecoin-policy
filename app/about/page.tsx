import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "关于 · 稳定币政策追踪",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-8 py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors mb-16"
        >
          ← 返回
        </Link>

        <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
          关于
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          这个网站是做什么的
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          <p>
            稳定币正在重塑全球支付体系，而各国政府对它的态度却大相径庭——有的积极立法推动，有的设置重重门槛，有的则明令禁止。我搭建这个网站，是因为我想要一个直接的答案：某个国家或地区，对稳定币究竟持什么立场？
          </p>
          <p>
            要回答这个问题，原本需要逐一翻阅各国议会网站、监管公告和行业简报。没有人把这些信息汇集到一个地方，于是我来做这件事。
          </p>
          <p>
            地图覆盖全球主要司法管辖区，包括美国各州、欧盟成员国、英国、亚洲各国等。点击任意国家或地区，可以看到当前正在推进的立法、监管机构、关键政策人物，以及最新资讯。每个司法管辖区都有一个立场评级，从“支持”到“限制”，基于其实际的法规和议案现状。
          </p>
          <p>
            稳定币监管是当下全球金融政策中变动最快的领域之一。欧盟 MiCA 已全面生效，美国《GENIUS 法案》正在国会推进，香港、新加坡、日本也各自建立了本地框架。与此同时，印度、俄罗斯等国仍对私人稳定币持谨慎甚至禁止态度。这张地图试图把这些分散的信息变成一幅可以纵览全局的图景。
          </p>
          <p>
            这个网站不为任何立场站台。它的目标是如实呈现：哪些法案正在审议、走到了哪个阶段、通过后会带来什么影响——让关心这个议题的人能够基于真实信息形成自己的判断。
          </p>

          <div className="pt-5 mt-5 border-t border-black/[.06]">
            <p className="text-muted">
              数据持续更新中，欢迎反馈与建议。如有问题或补充，请{" "}
              <Link
                href="/contact"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                联系我
              </Link>
              。
            </p>
          </div>
        </div>

        <div className="mt-16 pt-10 border-t border-black/[.06]">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-4">
            数据来源
          </div>
          <ul className="text-sm text-ink/80 leading-relaxed space-y-2">
            <li>
              本站 fork 自{" "}
              <a
                href="https://github.com/isabellereks/track-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                Isabelle Reksopuro
              </a>{" "}
              的开源项目 Track Policy，在其基础上专注于稳定币政策方向
            </li>
            <li>
              立法数据参考各国议会官网、监管机构公告及{" "}
              <a
                href="https://legiscan.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                LegiScan
              </a>
            </li>
            <li>
              地图灵感来源于{" "}
              <a
                href="https://datacenterbans.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                datacenterbans.com
              </a>
            </li>
            <li>
              图标来自{" "}
              <a
                href="https://streamlinehq.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                Streamline
              </a>
            </li>
            <li className="pt-2 text-muted">
              完整数据来源详见{" "}
              <Link
                href="/methodology"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                方法论
              </Link>{" "}
              页面。
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
