interface CustomAboutDialogHtmlInput {
  applicationName: string;
  appVersion: string;
  copyright: string;
  optimizationLine: string;
  versionLabel: string;
  okButtonLabel: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createCustomAboutDialogHtml(input: CustomAboutDialogHtmlInput): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <title>${escapeHtml(input.applicationName)}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        --startup-page-bg: #f4f4f5;
        --about-primary: #0a0a0a;
        --about-primary-foreground: #fafafa;
        --about-primary-active: color-mix(in oklab, var(--about-primary) 80%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: var(--startup-page-bg);
      }

      body {
        display: grid;
        place-items: center;
        padding: 0;
        user-select: none;
      }

      .about-window {
        width: 100%;
        max-width: 256px;
        height: 280px;
        display: grid;
        place-items: stretch;
        padding: 0;
        background: transparent;
      }

      .about-card {
        width: 100%;
        height: 100%;
        padding: 22px 15px 14px;
        display: flex;
        flex-direction: column;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #1d1d1f;
        box-shadow: none;
        -webkit-app-region: drag;
      }

      .content {
        width: 100%;
        max-width: 222px;
        margin: 0 auto;
        flex: 1;
        min-height: 0;
      }

      /* 品牌 Logo 自带红底与圆角，容器只保留尺寸与投影。*/
      .app-icon {
        width: 52px;
        height: 52px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        box-shadow: 0 10px 13px -3px rgb(0 0 0 / 0.2), 0 4px 5px -3px rgb(0 0 0 / 0.2);
      }

      .app-logo {
        width: 52px;
        height: 52px;
        border-radius: 12px;
        display: block;
      }

      .title {
        margin: 20px 0 0;
        font-size: 13.5px;
        line-height: 1.18;
        font-weight: 700;
        letter-spacing: 0;
      }

      .meta {
        margin-top: 28px;
        display: flex;
        flex-direction: column;
        gap: 17px;
        font-size: 13px;
        line-height: 1.2;
        font-weight: 400;
        letter-spacing: 0;
        color: #303033;
      }


      .ok-button {
        width: 100%;
        height: 36px;
        border: 0;
        border-radius: 18px;
        background: var(--about-primary);
        color: var(--about-primary-foreground);
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0;
        outline: none;
        cursor: default;
        -webkit-app-region: no-drag;
      }

      .ok-button:active {
        background: var(--about-primary-active);
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --startup-page-bg: #171717;
          --about-primary: #fafafa;
          --about-primary-foreground: #0a0a0a;
          --about-primary-active: color-mix(in oklab, var(--about-primary) 80%, transparent);
        }

        .about-card {
          color: #e8e8e8;
        }

        .meta {
          color: #e2e2e2;
        }
      }
    </style>
  </head>
  <body>
    <main class="about-window" aria-label="${escapeHtml(input.applicationName)} About Window">
      <section class="about-card" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <div class="content">
          <div class="app-icon" aria-hidden="true">
            <img
              class="app-logo"
              src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAOo0lEQVR4Ae3Bz9GbWKLG4Z9OKYCzoVhRaCKwdiz5HEF/E0HjDOgIfBxBk0HTEfTXEVgsWV05goFiRbE5GcytuV11C3tcckuA/vE+DyIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiInLnNsh31VH8wtde+L53gOUye8Cybh44chkPfOH7DowkXXtA/suGlamj+AWwwJ6/pPzFAntkDY6A5y8VfzkCPunaAyuy4QnVUWyBPbAH3gE7YA9YRH7MA0egAb4AR+CYdK3nyWx4AnUU74AXIAX2wB6R+R2BI1ABh6RrGx7chgdVR/ErkAKvwA6R62uAN6BKuvaNB7ThgdRR/Ar8BLwCFpH74YE34M+ka994EBvuXB3FFsiBn4EdIvevAX4HiqRrPXdsw52qo3gHfAQyRB5XCXxKurbhDm24M3UUW+AjkCPyPArgU9K1njuy4Y7UUZwDHwGLyPPxwKekawvuxIY7UEfxDvgNeEHk+R2AD0nXNtzYhhurozgDfgUsIuvhgV+Sri25oQ03VEfxb0CG3K106JlTFYTIV8qkaz9wI1tuoI5iC/wBvCCyblkdxTvgn0nXeq7McGV1FFvgM/CCiPzHC/C5jmLLlRmuqI5iC3wG9ojI2B74XEex5Yq2XNcfwB65W+nQc4r3DVNYu+NcVRCyEnvgD+A9V2K4kjqKfwNeEJFTXuoo/o0rMVxBHcUZkCEif0dWR3HGFRgWVkfxDvgVETnHr3UU71jYhoXVUfwZeEGuIh165uR9w9Ks3TFFFYQ8qUPSte9ZkGFBdRTnwAsicomXOopzFmRYSB3FFviIiEzxsY5iy0IMy/kIWERkCgt8ZCEbFlBH8Q74FzJZOvScw/uGZ2ftjlOqIOQJ/SPp2oaZGZbxERGZ00cWYJhZHcUWyBCROWV1FFtmZphfjogsIWdmhvn9jIgs4WdmtmFGdRS/An8gf0s69JzL+wb5mrU7TqmCkCfyz6Rr35iJYV4/ISJL+okZGeb1iogs6ZUZGWZSR/ErYBGRJdk6il+ZyZb5pMjsvG+QadKhZ6wKQh5cCrwxA8N8XhGRa3hlJoYZ1FG8A3aIyDXs6ijeMQPDPF4QkWt6YQZb5pEiP5QOPT/ifYOcx/uGMWt3rEAKlExkmMceEbmmPTMwTFRHsQX2iMg17esotkxkmG6PiNzCnom2TLfnQaRDzzmqIGRJ3jeITLAHDkxgmO4dInIL75jIMN0OEbmFHRMZptsjIrewZ6It01luJB16lpQOPeeoghC5P1UQ8qQsExkmqKP4BRG5mTqKX5jAMI1FRG7JMoFhmj0ickt7JtjyQNKh5xy5K5lT4TJOSYeesSoIOcXaHd/yvuGZWbvjR7xvOIe1O8aqIET+HsM0KSJySykTGERktQzTWETkliwTbJigjuJ/s5B06PmR3JXck8JlnFIFIWPp0PMj3jecYu2OU7xvuCfW7phbFYSsWdK1Gy5kEJHVMojIahkuVEfxCyJyc3UUv3ChDReqo/gF+MxM0qHnR3JX8kgKl3Fr3jfcO2t3nFIFIXLS+6RrD1zAICKrZRCR1TJc7gURuQcvXGjLncpdybec9SzJecucclcyVriMsSoIOVc69JzifYPI32UQkdUyiMhqGURktbbcSDr0jOWuZMxZz7U56znFecuc0qHnW1UQInIthsu9Q0TuwTsuZLicRUTugeVCBhFZrS1Xkg49pzjb8DXLvXHWM+a85Ry5KxkrXMa30qFnrApC1qYKQuQ6DCKyWgYRWS2DiKzWFrmZ3JV8q3AZY+nQ80ys3bG0dOiZogpC1sIgIqtlEJHVMojIam1ZSDr0nOILx6Nz1jPmvEXOVwUh50iHniWlQ885qiDkURlEZLUMIrJaBhFZrS2X23NCFYSMpUOP/FjuSsYKl7F26dBzSu5KrqlwGWPp0DNWBSFXtudChstZROQeWC5kEJHVMojIahlEZLW2rJrna5YpnPWMOW+5Nmt3nMP7hltLh55z5K7klnJXMla4jLF06PlWFYTcI4OIrJZBRFbLICKrteVuef6b5TyeZ5O7klMKl3EOa3csyfuGMe8bvmXtjlNyV7IkZz3ncN4ylruSscJlPAqDiKyWQURWyyAiq7XhQnUU/5szpEPPmC8Kvub5Mctpnq9ZvuaZxjKF85apCpcxlruSKQqX8ehyV3KKs54lOW8ZK1zGj1RByJySrt1wAYOIrJZBRFbLICKrtWUh6dBzHst0lq95prE8usJlnOJ9wxTW7hjLXckphcs4l/cNY9buGCtcxpgvCq7JWc9XXMm3CpdxjwwisloGEVktg4is1pa74fma5fos9y53JacULmPM+4ZrKlzGWO5KzuV9wyneN4xZu2PM5jljviiQ7zOIyGoZRGS1DCKyWhsuVEfxvzlDOvSc4ouC6TzzsszJecvSCpcx5n3DNVm741zeN8zJ2h2n+KLg2myeM1YFIXNKunbDBQwisloGEVktg4is1panYvmaZxrP1yz3pnAZY9433JL3DWPW7hjzvmFp3jeMWbtDvs8gIqtlEJHVMojIam25kioIGUuHnjGb54z5omA6yy3ZPGcsdyWyPGt33JLNc75VBSH3yCAiq2UQkdUyiMhqbbmRKggZS4eeMZvnfMsXBffM5jlLK1zGmPcN98TaHddm7Q65jEFEVssgIqtlEJHV2nInqiBkLB16vmXznFN8UXBNNs85JXclz87aHfK1Kgh5FAYRWS2DiKyWQURWa8udqoKQb6VDzyk2zxG5NpvnjFVByKMwiMhqGURktQwislpbHkgVhJySDj3XlLsSWR+b54xVQcijMojIahlEZLUMIrJaW55IFYTMKR16RGyeM1YFIc/CICKrZRCR1TKIyGptkf+XDj2n5K7k3li7Y8z7hmvyvmHM2h1j3jfcO5vnnFIFIc/KICKrZRCR1TKIyGptkYeSu5KxwmXIeWyeM1YFIUtLh55TqiDkFgwisloGEVktg4isluFyHhG5B54LbbhQHcWfgRceWDr0nCN3JVMULmMsdyVzK1zGmPcNS9rZHWOZKxkrXMaY9w1TWbtjLHclpxQu4xxVEDJFOvRMVQUhZzgkXfueCxhEZLUMIrJaBhFZrQ0XqqP4M/DCHUuHnnNUQchYOvSckruScxQu40dyVzKnwmWMed8whbU7TsldySmFy5gqdyVTFC7jlCoIOUc69CytCkJOOCRd+54LGERktQwisloGEVmtDReqo/gz8MIdSYeeU6og5Bzp0HOO3JWco3AZU+Wu5ByFy5hT7koeXeEy7l0VhJxwSLr2PRcwiMhqGURktQwislpbnlgVhFxT4TLGcldySu5KzlW4jClyV3JK4TLGclfy7HJXMla4jLUwiMhqGS7nEZF74LmQ4XJfEJF78IULbVmxdOiRr+Wu5NkVLuOU3JWcUriMpVVByDUYRGS1DCKyWgYRWa0NF6qj2AEfuaF06BmrgpBzpEPPWBWETJEOPafkrkTuX+EyxnJXMnY8Nowd3hxTVUHIBJ+SrnVcwHC5AyJyDw5cyCAiq2UQkdXa8sCqIOSeVEHIWDr0jBUuY6rclciyclcyVriMuVVByD0wXCjp2gMicnNJ1x64kEFEVssgIqu1ZZojsEe+qwpCTkmHnqUVLuOU3JWsXeEy5lQFIVd0ZALDNB4RuSXPBAYRWS3DNBUicksVE2xZsSoIuaZ06DlX7kqWVLiMc+Su5NEULmOKKggZS4eesSoIeVSGaY6IyC0dmcAwjUdEbskzgWGCpGsPiMjNJF17YIIt03nAIrPIXcmcclcy1hw9Y29vOecoXMazqYKQKdKhZ6wKQq7EM5FhuiMicgtHJjJM1yAit9AwkWG6L4jILXxhoi3THZHvSoeeU3JXcm27vWXslYJT3t5ynk0VhExRBSFj6dBzI0cmMkx3RERu4chEhomSrvXAERG5pmPStZ6JDPM4IiLXdGQGW+ZRARkrlw49p+Su5NlVQcjS0qHnlCoIuaYqCLmBihkY5nFARK7pwAwMM0i6tgEaROQamqRrG2ZgmM8bInINb8xky3wqIOeJpUPPOXJXcu92e8tYc/SMvb4WjL295dxaFYSMpUPPWDr0nFIFIQ+uYiaGmSRd+wZ4RGRJPunaN2ZimNcbIrKkN2ZkmNefiMiS/mRGG2ZWR/G/gB1PKB16TsldyaNrjp5zvL3lnFIFITKbJunafzAjw/x+R0SW8DszM8yvQESWUDAzw8ySrvVAiYjMqUy61jMzwzI+ISJz+sQCNiykjuJfgZwnkg49Y7kreTbN0TPF21vOKVUQImcrkq79hQUYlvMJ8IjIFB74xEIMC0m61gOfEJEpPiVd61mIYUFJ1xbAARG5xCHp2oIFbVneB+B/AMuDSYeetdntLWPN0SM34YEPLMywsKRrG+AXROQcvyRd27AwwxUkXVsCJSLyd5RJ15ZcgeFKkq79ABwQkVMOSdd+4Eo2XFEdxRb4DOy5Q+nQc0ruStauOXrO8faW8yNVECL/5wi8T7rWcyWGK0q61gPvgSMiMnYE3idd67kiw5UlXeuB98ABEfmPA/A+6VrPlW25gaRrPfC+juLfgAyR9SqTrv3AjWy4sTqKM+BXwCKyHh74JenakhvacAfqKN4BvwEviDy/A/Ah6dqGG9twR+oozoGPgEXk+XjgU9K1BXdiw52po9gCH4EckedRAJ+SrvXckQ13qo7iHfARyBB5XCXwKenahju04c7VUWyBHPgZ2CFy/xrgd6BIutZzxzY8kDqKX4GfgFfAInI/PPAG/Jl07RsPYsODqqP4FUiBV2CHyPU1wBtQJV37xgPa8ATqKN4BL0AK7IE9IvM7AkegAg5J1zY8uA1PqI5iC+yBPfAO2AF7wCLyYx44Ag3wBTgCx6RrPU9mw8rUUfwCWGDPX1L+YoE9sgZHwPOXir8cAZ907YEV2SDfVUfxC1974fveAZbL7AHLunngyGU88IXvOzCSdO0BERERERERERERERERERERERERERERERERERERkYfzv1azDC1f0N12AAAAAElFTkSuQmCC"
              alt=""
              aria-hidden="true"
              width="52"
              height="52"
              focusable="false"
            />
          </div>
          <h1 id="about-title" class="title">
            ${escapeHtml(input.applicationName)}<br />
            ${escapeHtml(input.versionLabel)} ${escapeHtml(input.appVersion)}
          </h1>
          <div class="meta">
            ${input.optimizationLine ? `<div>${escapeHtml(input.optimizationLine)}</div>` : ""}
            <div>${escapeHtml(input.copyright)}</div>
          </div>
        </div>
        <div class="spacer"></div>
        <button class="ok-button" type="button" autofocus>${escapeHtml(input.okButtonLabel)}</button>
      </section>
    </main>
    <script>
      const closeWindow = () => window.close();
      document.querySelector(".ok-button")?.addEventListener("click", closeWindow);
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" || event.key === "Enter") {
          closeWindow();
        }
      });
    </script>
  </body>
</html>`;
}
